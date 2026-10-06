import { WebClient } from "@slack/web-api";
export function slackClient(){const token=process.env.SLACK_BOT_TOKEN;return token?new WebClient(token):null}
