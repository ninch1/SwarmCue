// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubtitleControl } from "./SubtitleControl.js";

function renderControl(overrides: Partial<Parameters<typeof SubtitleControl>[0]> = {}) {
  const props = {
    fileName: null,
    enabled: false,
    skippedBlocks: 0,
    loading: false,
    error: null,
    onFileSelected: vi.fn(),
    onEnabledChange: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  };
  render(<SubtitleControl {...props} />);
  return props;
}

function fileInput(container: HTMLElement = document.body): HTMLInputElement {
  return container.querySelector('input[type="file"]')!;
}

describe("SubtitleControl", () => {
  afterEach(() => {
    cleanup();
  });

  it("offers to add subtitles when none is loaded", () => {
    const props = renderControl();
    const file = new File(["x"], "movie.srt");

    expect(screen.getByText("Add subtitles")).toBeTruthy();
    expect(fileInput().accept).toBe(".srt,.vtt");
    fireEvent.change(fileInput(), { target: { files: [file] } });

    expect(props.onFileSelected).toHaveBeenCalledWith(file);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("shows the loaded file with toggle, replace, and remove", () => {
    const props = renderControl({ fileName: "movie.en.srt", enabled: true });
    const replacement = new File(["x"], "movie.fr.vtt");

    expect(screen.getByText("movie.en.srt")).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Show" }));
    expect(props.onEnabledChange).toHaveBeenCalledWith(false);

    expect(screen.getByText("Replace")).toBeTruthy();
    fireEvent.change(fileInput(), { target: { files: [replacement] } });
    expect(props.onFileSelected).toHaveBeenCalledWith(replacement);

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(props.onRemove).toHaveBeenCalled();
  });

  it("reflects a disabled subtitle in the checkbox", () => {
    renderControl({ fileName: "movie.srt", enabled: false });

    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });

  it("shows a parsing error next to the still-active subtitle", () => {
    renderControl({
      fileName: "good.srt",
      enabled: true,
      error: { fileName: "bad.srt", message: "No subtitles could be read from this file." },
    });

    expect(screen.getByRole("alert").textContent).toBe(
      "Couldn't use bad.srt. No subtitles could be read from this file.",
    );
    expect(screen.getByText("good.srt")).toBeTruthy();
  });

  it("mentions skipped entries", () => {
    renderControl({ fileName: "movie.srt", enabled: true, skippedBlocks: 3 });

    expect(screen.getByText("3 entries could not be read and were skipped.")).toBeTruthy();
  });

  it("disables picking and removing while a file is being read", () => {
    renderControl({ fileName: "movie.srt", enabled: true, loading: true });

    expect(fileInput().disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Remove" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByRole("status").textContent).toBe("Reading…");
  });
});
