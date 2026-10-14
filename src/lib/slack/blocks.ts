import type { Block, KnownBlock } from "@slack/types";
export class BriefingSizeError extends Error {}
export function boundedBlocks(blocks: (KnownBlock | Block)[]): (KnownBlock | Block)[] {
  const result = blocks.flatMap(block => {
    if (block.type !== "section" || !("text" in block) || !block.text || block.text.type !== "mrkdwn") return [block];
    const text = block.text.text;
    const parts: string[] = []; let current = "";
    for (const line of text.split("\n")) {
      if (current.length + line.length + 1 > 2800 && current) { parts.push(current); current = ""; }
      if (line.length > 2800) throw new BriefingSizeError("A briefing line is too long. Shorten the note before posting.");
      current += (current ? "\n" : "") + line;
    }
    if (current) parts.push(current);
    return parts.map(text => ({ type: "section" as const, text: { type: "mrkdwn" as const, text } }));
  });
  if (result.length > 50) throw new BriefingSizeError("This briefing has too much content for one Slack message. Reduce notes or split the team briefing.");
  return result;
}
