import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SafeMarkdown } from "./safe-markdown";

afterEach(() => cleanup());

describe("SafeMarkdown", () => {
  it("renders basic formatting", () => {
    const { container } = render(
      <SafeMarkdown
        text={"**Bold** and `code`\n\n- one\n- two\n\n1. a\n2. b"}
      />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("Bold");
    expect(container.querySelector("code")?.textContent).toBe("code");
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
  });

  it("never creates executable or remote-loading elements from model output", () => {
    const evil = [
      "<script>window.__pwned = 1</script>",
      '<img src=x onerror="window.__pwned=1">',
      "[click](javascript:alert(1))",
      "![i](https://evil.example/track.png)",
      '<iframe src="https://evil.example"></iframe>',
    ].join("\n\n");
    const { container } = render(<SafeMarkdown text={evil} />);
    expect(
      container.querySelector("script, img, iframe, a, [onerror]"),
    ).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(screen.getByText(/<script>/)).toBeInTheDocument(); // shown as inert text
  });
});
