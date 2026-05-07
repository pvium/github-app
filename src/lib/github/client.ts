import { App } from "@octokit/app";
import { getEnv } from "@/lib/config/env";

let app: App | null = null;

function getGithubApp() {
  const env = getEnv();
  app ??= new App({
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
  });
  return app;
}

export async function getInstallationOctokit(installationId: number | bigint) {
  return getGithubApp().getInstallationOctokit(Number(installationId));
}

export async function createIssueComment(params: {
  installationId: number | bigint;
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
}) {
  const octokit = await getInstallationOctokit(params.installationId);
  return octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/comments", {
    owner: params.owner,
    repo: params.repo,
    issue_number: params.issueNumber,
    body: params.body,
  });
}
