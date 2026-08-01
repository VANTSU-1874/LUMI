"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import styles from "./student-app.module.css";

type SpeechResultEvent = Event & {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};

type SpeechErrorEvent = Event & {
  error?: string;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort?(): void;
};

type SpeechWindow = {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

function speechRecognitionConstructor() {
  if (typeof window === "undefined") return undefined;
  const speechWindow = window as unknown as SpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

function subscribeSpeechSupport() {
  return () => undefined;
}

function speechSupportSnapshot() {
  return Boolean(speechRecognitionConstructor());
}

function abortRecognition(recognition: SpeechRecognitionLike) {
  if (recognition.abort) recognition.abort();
  else recognition.stop();
}

function transcriptFrom(event: SpeechResultEvent) {
  const parts: string[] = [];
  for (let index = 0; index < event.results.length; index += 1) {
    const transcript = event.results[index]?.[0]?.transcript;
    if (typeof transcript === "string" && transcript.trim()) parts.push(transcript.trim());
  }
  return parts.join("");
}

function appendTranscript(base: string, transcript: string) {
  const normalizedBase = base.trimEnd();
  if (!normalizedBase) return transcript;
  const needsSeparator = !/[\s，。！？；：,.!?;:]$/u.test(normalizedBase);
  return `${normalizedBase}${needsSeparator ? " " : ""}${transcript}`;
}

function speechErrorMessage(error: string | undefined) {
  if (error === "not-allowed" || error === "service-not-allowed") {
    return "未获得麦克风权限，可在浏览器地址栏允许后重试。";
  }
  if (error === "audio-capture") return "没有找到可用麦克风，仍可键盘输入。";
  if (error === "no-speech") return "没有听到清晰语音，请靠近麦克风后重试。";
  if (error === "network") return "语音识别服务暂时不可用，仍可键盘输入。";
  return "语音输入没有完成，仍可键盘输入。";
}

export function SpeechInputButton({
  value,
  onValueChange,
  onListeningChange,
  disabled = false,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onListeningChange: (listening: boolean) => void;
  disabled?: boolean;
}) {
  const supported = useSyncExternalStore(subscribeSpeechSupport, speechSupportSnapshot, () => false);
  const [listening, setListening] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [notice, setNotice] = useState("");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const baseValueRef = useRef("");
  const acceptingResultsRef = useRef(false);
  const receivedResultRef = useRef(false);
  const truncatedResultRef = useRef(false);

  useEffect(() => {
    return () => {
      acceptingResultsRef.current = false;
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      if (recognition) abortRecognition(recognition);
    };
  }, []);

  useEffect(() => {
    if (!disabled || !recognitionRef.current) return;
    const recognition = recognitionRef.current;
    acceptingResultsRef.current = false;
    recognitionRef.current = null;
    abortRecognition(recognition);
    setStopping(false);
    setListening(false);
    onListeningChange(false);
  }, [disabled, onListeningChange]);

  function updateListening(next: boolean) {
    if (!next) setStopping(false);
    setListening(next);
    onListeningChange(next);
  }

  function stop() {
    if (stopping || !recognitionRef.current) return;
    setStopping(true);
    setNotice("正在整理识别文字…");
    try {
      recognitionRef.current.stop();
    } catch {
      acceptingResultsRef.current = false;
      recognitionRef.current = null;
      setNotice("语音输入没有正常结束，已保留当前文字。");
      updateListening(false);
    }
  }

  function start() {
    const SpeechRecognition = speechRecognitionConstructor();
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    baseValueRef.current = value;
    receivedResultRef.current = false;
    truncatedResultRef.current = false;
    acceptingResultsRef.current = true;
    recognition.onresult = (event) => {
      if (recognitionRef.current !== recognition || !acceptingResultsRef.current) return;
      const transcript = transcriptFrom(event);
      if (!transcript) return;
      receivedResultRef.current = true;
      const nextValue = appendTranscript(baseValueRef.current, transcript);
      truncatedResultRef.current = nextValue.length > 2_000;
      onValueChange(nextValue.slice(0, 2_000));
    };
    recognition.onerror = (event) => {
      if (recognitionRef.current !== recognition) return;
      acceptingResultsRef.current = false;
      recognitionRef.current = null;
      setNotice(speechErrorMessage(event.error));
      updateListening(false);
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      acceptingResultsRef.current = false;
      updateListening(false);
      setNotice((current) => receivedResultRef.current
        ? truncatedResultRef.current
          ? "语音已写入，并达到本轮 2000 字上限。"
          : "语音已写入输入框，可修改后发送。"
        : current || "没有识别到文字，请重试。");
    };
    recognitionRef.current = recognition;
    setNotice("");
    setStopping(false);
    updateListening(true);
    try {
      recognition.start();
    } catch {
      acceptingResultsRef.current = false;
      recognitionRef.current = null;
      setNotice("语音输入暂时无法启动，仍可键盘输入。");
      updateListening(false);
    }
  }

  if (!supported) return null;

  return <div className={styles.speechInput}>
    <button
      aria-describedby="lumi-composer-privacy"
      aria-label={stopping ? "正在结束语音输入" : listening ? "停止语音输入" : "开始语音输入"}
      aria-pressed={listening}
      className={`${styles.speechButton} ${listening ? styles.speechButtonListening : ""}`}
      disabled={disabled || stopping}
      onClick={listening ? stop : start}
      type="button"
    >
      <MicrophoneIcon />
      <span className={styles.speechLabel}>{stopping ? "正在结束" : listening ? "停止语音" : "语音输入"}</span>
      {listening ? <i aria-hidden="true" /> : null}
    </button>
    {listening || notice ? <p className={styles.speechNotice} id="lumi-speech-status" role="status">
      {stopping ? "正在结束并整理识别文字…" : listening ? "正在聆听，完成后仍可修改文字。" : notice}
    </p> : null}
  </div>;
}

function MicrophoneIcon() {
  return <svg aria-hidden="true" className={styles.speechIcon} fill="none" viewBox="0 0 24 24">
    <rect height="10" rx="3.5" width="7" x="8.5" y="3" />
    <path d="M5.5 10.5v1a6.5 6.5 0 0 0 13 0v-1M12 18v3M8.5 21h7" />
  </svg>;
}
