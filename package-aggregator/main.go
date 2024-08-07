package main

import (
	"context"
	"encoding/json"
	"flag"
	"github.com/google/go-github/v63/github"
	"golang.org/x/oauth2"
	"log"
	"log/slog"
	"os"
	"strings"
	"time"
)

var (
	outFileName, githubToken, orga, prefix, workflowfile, exclude string
	stale                                                         float64
)

type packageState struct {
	// Status is either one of "progress", "success", "stale" or "failure" (the states known to the daily-dashboard)
	// or it can be workFlowNotFound (in case no workflow is defined in build.yml)
	// or it can be noRunFound (in case a workflow file in build.yml exists, but no run has been executed yet)
	// or it can be brokenTimestamp (in case the GitHub API returns an invalid timestamp for the run)
	Status string `json:"Status"`
	// Time is the Time at which this tool tried to grab data from GitHub
	// in case there is a workflow run that contains more precise data (UpdatedAt), that timestamp is used
	Time string `json:"Time"`
	// Name is the name of the repository
	Name string `json:"Name"`
}

func main() {
	config()

	ctx, client := getGitHubClient()

	repoNames := getPackageRepoNames(client, ctx)

	var packageStates []packageState

	for _, repoName := range repoNames {
		packageStates = append(packageStates, getPackageStateByRepoName(repoName, client, ctx))
	}

	out, err := json.MarshalIndent(packageStates, "", " ")
	if err != nil {
		slog.Error("Error marshalling json", "err", err.Error())
	}

	err = os.WriteFile(outFileName, out, 0644)
	if err != nil {
		slog.Error("Error writing file", "err", err.Error())
		os.Exit(1)
	}
}

func getPackageStateByRepoName(repoName string, client *github.Client, ctx context.Context) packageState {
	now := time.Now()
	nowString, _ := now.MarshalText() // I trust that Time.Now() returns something parsable
	ps := packageState{Time: string(nowString), Name: repoName}

	wfRuns, _, err := client.Actions.ListWorkflowRunsByFileName(ctx, orga, repoName, workflowfile, &github.ListWorkflowRunsOptions{})
	if err != nil {
		slog.Warn("Failed to get workflow", "repo", repoName, "err", err)
		ps.Status = "workFlowNotFound"
		return ps
	}
	if *wfRuns.TotalCount < 1 {
		slog.Warn("Failed to get workflow run, list of runs was empty", "repo", repoName)
		ps.Status = "noRunFound"
		return ps
	}
	// logic same as here: https://github.com/gardenlinux/daily/blob/3753fd9e9b5eb931eb62f468a2558c5f081065b2/index.html#L60
	timeStamp := wfRuns.WorkflowRuns[0].UpdatedAt
	if timeStamp != nil {
		timeStampText, err := timeStamp.MarshalText()
		// in case of an error, we just use the default stamp set above
		if err != nil {
			slog.Warn("Failed to parse workflow run timestamp", "repo", repoName, "err", err)
			ps.Status = "brokenTimeStamp"
			return ps
		}
		ps.Time = string(timeStampText)
	}
	if wfRuns.WorkflowRuns[0].GetStatus() == "in_progress" {
		ps.Status = "progress"
	} else {
		if wfRuns.WorkflowRuns[0].GetStatus() == "completed" {
			if wfRuns.WorkflowRuns[0].GetConclusion() == "success" {
				if now.Sub(timeStamp.Time).Hours() > stale {
					ps.Status = "stale"
				} else {
					ps.Status = "success"
				}
			} else {
				ps.Status = "failure"
			}
		}
	}
	return ps
}

func getPackageRepoNames(client *github.Client, ctx context.Context) []string {

	var allRepos, packageRepos []string         // looping and append is enough
	prefixRepos := make(map[string]interface{}) // we want to delete here
	opt := &github.RepositoryListByOrgOptions{
		ListOptions: github.ListOptions{PerPage: 30},
	}
	// get all pages of results
	for {
		repos, resp, err := client.Repositories.ListByOrg(ctx, orga, opt)
		if err != nil {
			slog.Error(err.Error())
			os.Exit(1)
		}
		for _, repo := range repos {
			if !*repo.Archived {
				allRepos = append(allRepos, *repo.Name)
			}
		}
		if resp.NextPage == 0 {
			break
		}
		opt.Page = resp.NextPage
	}

	// select repos matching the prefix-criteria
	for _, repo := range allRepos {
		if strings.HasPrefix(repo, prefix) {
			prefixRepos[repo] = nil // we are just interested in the keys
		}
	}

	// delete repos that are in the exclude-list
	for _, ex := range strings.Split(exclude, ",") {
		delete(prefixRepos, ex)
	}

	// collect the remaining into slice
	for repo, _ := range prefixRepos {
		packageRepos = append(packageRepos, repo)
	}

	return packageRepos
}

func getGitHubClient() (context.Context, *github.Client) {
	// default context
	ctx := context.Background()

	ts := oauth2.StaticTokenSource(
		&oauth2.Token{AccessToken: githubToken},
	)
	tc := oauth2.NewClient(ctx, ts)
	client := github.NewClient(tc)
	return ctx, client
}

func config() {
	log.SetFlags(0)
	flag.StringVar(&outFileName, "o", "test.json", "output filename")
	flag.StringVar(&orga, "orga", "gardenlinux", "The GitHub organization name to scrape")
	flag.StringVar(&prefix, "prefix", "package-", "filter the organizations repos by this prefix")
	flag.StringVar(&workflowfile, "workflowfile", "build.yml", "scrape workflow runs of this file")
	flag.StringVar(&exclude, "exclude", "", "a comma seperated list of repositories to exclude from scraping")
	flag.Float64Var(&stale, "stale", 24, "time after which a package should be considered stale (even if the run was successful)")

	flag.Parse()

	ghT, set := os.LookupEnv("GITHUB_TOKEN")
	if !set {
		slog.Error("GITHUB_TOKEN environment variable not set")
		os.Exit(1)
	}
	githubToken = ghT
}