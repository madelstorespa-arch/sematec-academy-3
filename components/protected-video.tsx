'use client';
/** Reproductor sin botón de descarga para quienes solo pueden ver la grabación. */
export function ProtectedVideo({ src, allowDownload }: { src: string; allowDownload: boolean }) {
  return (
    <video src={src} controls preload="metadata" className="max-h-[70vh] w-full rounded-xl bg-black" data-testid="video-protegido"
      controlsList={allowDownload ? undefined : 'nodownload'} disablePictureInPicture={!allowDownload}
      onContextMenu={allowDownload ? undefined : (e) => e.preventDefault()} />
  );
}
