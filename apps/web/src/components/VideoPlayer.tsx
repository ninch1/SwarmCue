type VideoPlayerProps = {
  src: string | null;
};

export function VideoPlayer({ src }: VideoPlayerProps) {
  return (
    <section
      className="grid aspect-video place-items-center overflow-hidden rounded-[10px] border border-border bg-black"
      aria-label="Video player"
    >
      {src ? (
        <video
          key={src}
          src={src}
          controls
          playsInline
          className="block h-full w-full bg-black"
        />
      ) : (
        <div className="px-6 py-6 text-center text-muted">
          <p className="m-0">No media loaded</p>
          <p className="m-0 mt-1.5 text-sm">
            Choose a local video file or paste a magnet link.
          </p>
        </div>
      )}
    </section>
  );
}
