import { describe, expect, it } from "vitest";
import { runCascade } from "./cascade";

describe("runCascade — anchor text", () => {
  it("drops a generic CTA and keeps the card's own title, rather than concatenating both", async () => {
    const html = `
      <a href="/boards-and-committees/affordable-housing-board" class="full-link-div w-inline-block">
        <div style="background-image:url(&quot;https://example.com/photo.jpeg&quot;)" class="image-dvi-in-card"></div>
        <div class="text-button">Learn More</div>
        <div class="div-block-4"><div class="collection-card-title">Affordable Housing Board</div></div>
      </a>
    `;
    const hits = await runCascade("https://example.gov/boards-and-committees", html);
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe("Affordable Housing Board");
  });

  it("still returns the plain trimmed text for an ordinary single-text-node anchor", async () => {
    const html = `<a href="/boards/planning-board">Planning Board</a>`;
    const hits = await runCascade("https://example.gov/boards", html);
    expect(hits[0].text).toBe("Planning Board");
  });
});
