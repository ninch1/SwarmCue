// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SubtitleControl, type SubtitleControlProps } from "./SubtitleControl.js";

function renderControl(overrides: Partial<SubtitleControlProps> = {}) {
  const props: SubtitleControlProps = {
    active: "off",
    onSelect: vi.fn(),
    personal: null,
    personalLoading: false,
    personalError: null,
    onPersonalFile: vi.fn(),
    onPersonalRemove: vi.fn(),
    room: null,
    canShare: true,
    shareBusy: false,
    shareError: null,
    onShareFile: vi.fn(),
    onRoomRemove: vi.fn(),
    notice: null,
    ...overrides,
  };
  render(<SubtitleControl {...props} />);
  return props;
}

function openPanel() {
  fireEvent.click(screen.getByRole("button", { name: /Manage/ }));
}

function fileInputIn(groupName: string): HTMLInputElement {
  return screen.getByRole("group", { name: groupName }).querySelector('input[type="file"]')!;
}

const room = { name: "room.en.srt", sharedByName: "Nini", ready: true };
const personal = { fileName: "mine.fr.vtt", skippedBlocks: 0 };

describe("SubtitleControl", () => {
  afterEach(() => {
    cleanup();
  });

  it("offers only Off when there is no subtitle", () => {
    renderControl();

    expect((screen.getByRole("radio", { name: "Off" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("radio", { name: "Room" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("radio", { name: "Mine" }) as HTMLInputElement).disabled).toBe(true);
  });

  it("lets the participant choose what they see", () => {
    const props = renderControl({ room, personal, active: "personal" });

    expect((screen.getByRole("radio", { name: "Mine: mine.fr.vtt" }) as HTMLInputElement).checked).toBe(
      true,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Room: room.en.srt" }));
    expect(props.onSelect).toHaveBeenCalledWith("shared");
    fireEvent.click(screen.getByRole("radio", { name: "Off" }));
    expect(props.onSelect).toHaveBeenCalledWith("off");
  });

  it("shows a room subtitle whose text is still loading", () => {
    renderControl({ room: { ...room, ready: false } });

    expect(screen.getByRole("radio", { name: "Room: loading…" })).toBeTruthy();
  });

  it("keeps file actions in the Manage panel", () => {
    renderControl();
    expect(screen.queryByRole("group", { name: "My subtitle" })).toBeNull();

    openPanel();

    expect(screen.getByRole("button", { name: /Manage/ }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(fileInputIn("My subtitle").accept).toBe(".srt,.vtt");
    expect(screen.getByText("Share a file with the room")).toBeTruthy();
  });

  it("adds, replaces and removes a personal subtitle", () => {
    const props = renderControl({ personal });
    openPanel();
    const file = new File(["x"], "other.srt");

    expect(screen.getByText("Replace")).toBeTruthy();
    fireEvent.change(fileInputIn("My subtitle"), { target: { files: [file] } });
    expect(props.onPersonalFile).toHaveBeenCalledWith(file);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(props.onPersonalRemove).toHaveBeenCalled();
  });

  it("keeps turning subtitles off for me separate from removing for everyone", () => {
    const props = renderControl({ room, active: "shared" });
    openPanel();

    fireEvent.click(screen.getByRole("radio", { name: "Off" }));
    expect(props.onSelect).toHaveBeenCalledWith("off");
    expect(props.onRoomRemove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove for everyone" }));
    expect(props.onRoomRemove).toHaveBeenCalledTimes(1);
  });

  it("shares or replaces the room subtitle and shows who shared it", () => {
    const props = renderControl({ room });
    openPanel();
    const file = new File(["x"], "new.srt");

    expect(screen.getByText("Replace for everyone")).toBeTruthy();
    expect(screen.getByText("Nini")).toBeTruthy();
    fireEvent.change(fileInputIn("Room subtitle"), { target: { files: [file] } });

    expect(props.onShareFile).toHaveBeenCalledWith(file);
  });

  it("disables sharing when the room's video is not playing here, or while sharing", () => {
    renderControl({ canShare: false });
    openPanel();
    expect(fileInputIn("Room subtitle").disabled).toBe(true);
    cleanup();

    renderControl({ shareBusy: true });
    openPanel();
    expect(fileInputIn("Room subtitle").disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toBe("Sharing…");
  });

  it("shows errors and notices", () => {
    renderControl({
      personal: { ...personal, skippedBlocks: 2 },
      personalError: { fileName: "bad.srt", message: "No subtitles could be read from this file." },
      shareError: "The video changed before the subtitle was shared.",
      notice: "Nini shared room.en.srt.",
    });

    const alerts = screen.getAllByRole("alert").map((alert) => alert.textContent);
    expect(alerts).toEqual([
      "Couldn't use bad.srt. No subtitles could be read from this file.",
      "Couldn't share the subtitle. The video changed before the subtitle was shared.",
    ]);
    expect(screen.getByText("Nini shared room.en.srt.")).toBeTruthy();
    expect(
      screen.getByText("2 entries of your subtitle could not be read and were skipped."),
    ).toBeTruthy();
  });
});
