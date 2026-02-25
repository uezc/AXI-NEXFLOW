import React, { useState, useEffect, useRef, useCallback } from 'react';

/** 片头：从 splash-videos 文件夹循环播放视频，叠层显示 Logo；可选 MP3 背景音；无视频时静态背景 + Logo。点击或「跳过」进入主界面 */
const SplashScreen: React.FC<{ onFinish: () => void }> = ({ onFinish }) => {
  const [videoUrls, setVideoUrls] = useState<string[]>([]);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [musicUrl, setMusicUrl] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI?.getSplashVideos) {
      setLoaded(true);
      return;
    }
    window.electronAPI.getSplashVideos().then((res) => {
      setVideoUrls(res.urls || []);
      setLogoUrl(res.logoUrl ?? null);
      setMusicUrl(res.musicUrl ?? null);
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const goNext = useCallback(() => {
    if (videoUrls.length <= 1) {
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
        videoRef.current.play().catch(() => {});
      }
      return;
    }
    setCurrentIndex((i) => (i + 1) % videoUrls.length);
  }, [videoUrls.length]);

  useEffect(() => {
    if (!videoUrls.length || !videoRef.current) return;
    const v = videoRef.current;
    const onEnded = () => goNext();
    v.addEventListener('ended', onEnded);
    v.play().catch(() => {});
    return () => v.removeEventListener('ended', onEnded);
  }, [videoUrls.length, currentIndex, goNext]);

  // 背景音乐：有 musicUrl 时自动播放，muted 状态同步到 audio
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = muted;
    if (musicUrl && !muted) {
      audio.play().catch(() => {});
    }
  }, [musicUrl, muted]);

  const handleSkip = useCallback(() => {
    onFinish();
  }, [onFinish]);

  if (!loaded) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-white/40 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  const hasVideo = videoUrls.length > 0;
  const currentVideoUrl = hasVideo ? videoUrls[currentIndex] : null;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-black flex items-center justify-center overflow-hidden cursor-pointer"
      onClick={handleSkip}
      role="presentation"
    >
      {/* 底层：视频或静态背景 */}
      {hasVideo && currentVideoUrl ? (
        <video
          key={currentVideoUrl}
          ref={videoRef}
          src={currentVideoUrl}
          className="absolute inset-0 w-full h-full object-cover"
          muted
          loop={false}
          playsInline
          disablePictureInPicture
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-gray-900 to-black" />
      )}

      {/* Logo 叠层（居中） */}
      {logoUrl && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <img
            src={logoUrl}
            alt="Logo"
            className="max-w-[50vw] max-h-[40vh] w-auto h-auto object-contain drop-shadow-lg"
          />
        </div>
      )}

      {/* 背景音乐（splash-videos 目录下 mp3，优先 bgm.mp3 / music.mp3） */}
      {musicUrl && (
        <audio ref={audioRef} src={musicUrl} loop playsInline />
      )}

      {/* 右上角：禁音 + 跳过（统一工具栏） */}
      <div
        className="absolute top-6 right-6 flex items-center gap-2 rounded-2xl bg-black/40 backdrop-blur-md border border-white/10 px-1 py-1.5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="toolbar"
        aria-label="片头控制"
      >
        {musicUrl && (
          <div className="flex items-center gap-2">
            <span className="text-white/70 text-xs whitespace-nowrap">声音</span>
            <button
              type="button"
              title={muted ? '开启声音' : '关闭声音'}
              onClick={() => setMuted((m) => !m)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border border-white/20 transition-colors focus:outline-none focus:ring-2 focus:ring-white/30 focus:ring-offset-2 focus:ring-offset-transparent ${muted ? 'bg-white/15' : 'bg-white/35'}`}
              aria-label={muted ? '开启声音' : '关闭声音'}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform mt-0.5 ml-0.5 ${muted ? 'translate-x-0' : 'translate-x-5'}`}
              />
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={handleSkip}
          className="px-4 py-2.5 rounded-xl bg-white/20 hover:bg-white/30 text-white text-sm font-medium transition-colors"
        >
          跳过
        </button>
      </div>

    </div>
  );
};

export default SplashScreen;
