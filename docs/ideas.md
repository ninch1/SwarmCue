# SwarmCue Ideas

Possible features for later. These are not planned or committed work.

- **Pick media before joining a room.** Let someone choose a video before creating or joining a room. Picking one would automatically create a room, with a randomly generated display name, and make that person its host. Today media controls are only shown to the host inside a room.
- **Subtitle timing offset.** Let a participant shift subtitles earlier or later when a file is out of sync with their copy of the video (for example by rewriting cue timestamps in the normalized WebVTT, or adjusting the loaded cues).
- **Subtitle encoding selector.** Personal subtitles must be UTF-8 today. A small selector (e.g. Windows-1251, Windows-1252) could retry decoding legacy files instead of asking the user to re-save them.
- **ASS/SSA subtitles.** These carry styling and positioning that WebVTT cannot express, so they would need a dedicated renderer.
- **Desktop/native companion for public swarms.** A desktop or native companion application that bridges conventional TCP/UDP BitTorrent swarms to browser WebRTC peers, so public torrents could be watched. Explicitly outside V1.
