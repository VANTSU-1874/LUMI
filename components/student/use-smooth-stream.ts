"use client";

import { useEffect, useRef, useState } from "react";

const DEFAULT_CHARACTERS_PER_SECOND = 72;

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function continuationStreamTarget(text: string, instantPrefix: string) {
  if (!instantPrefix) return text;
  if (text.startsWith(instantPrefix)) return text;
  if (instantPrefix.startsWith(text)) return instantPrefix;
  return `${instantPrefix}${text}`;
}

function shareStreamPrefix(text: string, shownText: string) {
  return text.startsWith(shownText) || shownText.startsWith(text);
}

/**
 * Smooths independently arriving server chunks into a steady character drain.
 * A completed or reduced-motion response is always shown immediately.
 */
export function useSmoothStream(
  text: string,
  isStreaming: boolean,
  charactersPerSecond = DEFAULT_CHARACTERS_PER_SECOND,
  instantPrefix = "",
) {
  const initialText = isStreaming ? instantPrefix : text;
  const shownRef = useRef(initialText);
  const previousFrameAtRef = useRef<number | undefined>(undefined);
  const characterCreditRef = useRef(0);
  const [shownText, setShownText] = useState(() => initialText);
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const streamTarget = isStreaming ? continuationStreamTarget(text, instantPrefix) : text;
  const hasText = streamTarget.length > 0;
  const shouldShowImmediately = !isStreaming || reducedMotion;
  const streamedText = shareStreamPrefix(streamTarget, shownText) ? shownText : "";

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    if (!isStreaming || !instantPrefix || !instantPrefix.startsWith(shownRef.current)) return;
    shownRef.current = instantPrefix;
    previousFrameAtRef.current = undefined;
    characterCreditRef.current = 0;
    setShownText(instantPrefix);
  }, [instantPrefix, isStreaming]);

  useEffect(() => {
    if (typeof requestAnimationFrame !== "function") return;

    if (shouldShowImmediately) {
      const frame = requestAnimationFrame(() => {
        shownRef.current = streamTarget;
        previousFrameAtRef.current = undefined;
        characterCreditRef.current = 0;
        setShownText(streamTarget);
      });
      return () => cancelAnimationFrame(frame);
    }

    if (!hasText) {
      const frame = requestAnimationFrame(() => {
        shownRef.current = "";
        previousFrameAtRef.current = undefined;
        characterCreditRef.current = 0;
        setShownText("");
      });
      return () => cancelAnimationFrame(frame);
    }

    if (!shareStreamPrefix(streamTarget, shownRef.current)) {
      shownRef.current = "";
      previousFrameAtRef.current = undefined;
      characterCreditRef.current = 0;
    }

    let frame = 0;
    const drain = (frameAt: number) => {
      const target = streamTarget;
      const shown = shownRef.current;
      if (!target.startsWith(shown)) {
        if (shown.startsWith(target)) return;
        shownRef.current = target;
        setShownText(target);
        return;
      }
      const elapsedMs = previousFrameAtRef.current === undefined
        ? 1_000 / charactersPerSecond
        : Math.min(100, Math.max(0, frameAt - previousFrameAtRef.current));
      previousFrameAtRef.current = frameAt;
      characterCreditRef.current += (elapsedMs / 1_000) * charactersPerSecond;
      const characterCount = Math.max(1, Math.floor(characterCreditRef.current));
      characterCreditRef.current = Math.max(0, characterCreditRef.current - characterCount);
      const targetCharacters = Array.from(target);
      const next = targetCharacters.slice(0, Array.from(shown).length + characterCount).join("");
      if (next !== shown) {
        shownRef.current = next;
        setShownText(next);
      }
      if (Array.from(next).length < targetCharacters.length) {
        frame = requestAnimationFrame(drain);
      }
    };

    frame = requestAnimationFrame(drain);
    return () => cancelAnimationFrame(frame);
  }, [charactersPerSecond, hasText, shouldShowImmediately, streamTarget]);

  return shouldShowImmediately ? streamTarget : streamedText;
}
