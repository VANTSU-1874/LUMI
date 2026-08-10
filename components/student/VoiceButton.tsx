"use client";

import { useEffect, useRef, useState } from "react";

type SpeechResultEvent = Event & {
  results: ArrayLike<{ readonly 0: { transcript: string } }>;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

type SpeechWindow = {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

export function VoiceButton({
  onTranscript,
  compact = false,
  disabled = false,
}: {
  onTranscript: (value: string) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => () => recognitionRef.current?.stop(), []);

  function toggle() {
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const speechWindow = window as unknown as SpeechWindow;
    const SpeechRecognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setNotice("当前浏览器不支持语音输入，请使用 Chrome 或 Edge。");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript?.trim();
      if (transcript) onTranscript(transcript);
      setListening(false);
    };
    recognition.onerror = () => {
      setNotice("没有听清，再说一次试试。");
      setListening(false);
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setNotice("");
    setListening(true);
    recognition.start();
  }

  return <div className="relative">
    <button
      aria-label={listening ? "停止语音输入" : "开始语音输入"}
      aria-pressed={listening}
      className={`${compact ? "size-10" : "size-12"} grid place-items-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-40 ${listening ? "animate-pulse border-[#ff765f] bg-[#ff765f] text-white" : "border-[#cbd8d2] bg-white text-[#17332d] hover:border-[#178b73] hover:bg-[#edf7f3]"}`}
      disabled={disabled}
      onClick={toggle}
      type="button"
    >
      <MicrophoneIcon />
    </button>
    {notice ? <p className="absolute bottom-full right-0 z-50 mb-2 w-64 rounded-xl bg-[#17332d] px-3 py-2 text-xs leading-5 text-white shadow-xl" role="status">{notice}</p> : null}
    <span className="sr-only" aria-live="polite">{listening ? "正在聆听" : notice}</span>
  </div>;
}

function MicrophoneIcon() {
  return <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
    <rect height="11" rx="4" width="7" x="8.5" y="2.5" />
    <path d="M5.5 10.5v1a6.5 6.5 0 0 0 13 0v-1M12 18v3M8.5 21h7" />
  </svg>;
}
