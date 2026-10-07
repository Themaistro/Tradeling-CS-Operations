import { NextResponse } from "next/server";
import { slackClient } from "@/lib/slack/client";
import { prisma } from "@/lib/db/prisma";
export async function GET(){const client=await slackClient();const settings=await prisma.appSettings.upsert({where:{id:"global"},create:{id:"global"},update:{}});if(!client)return NextResponse.json({connected:false,channelId:settings.slackChannelId,error:"Bot token is not configured. Add it in Settings → Slack."});try{const auth=await client.auth.test();return NextResponse.json({connected:true,team:auth.team,user:auth.user,channelId:settings.slackChannelId})}catch(error){return NextResponse.json({connected:false,channelId:settings.slackChannelId,error:error instanceof Error?error.message:"Slack connection failed."})}}
