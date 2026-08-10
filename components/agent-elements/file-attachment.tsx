"use client";

/* Local object URLs are intentional here; Next/Image cannot render them reliably. */
/* eslint-disable @next/next/no-img-element */

import * as React from "react";
import { useState } from "react";
import {
  IconX as X,
  IconFileText as FileText,
  IconFileCode as FileCode,
  IconFileTypeJs as FileJson,
  IconPhoto as ImageIcon,
} from "@tabler/icons-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type FileAttachmentProps = {
  id: string;
  filename: string;
  size?: number;
  isImage?: boolean;
  url?: string;
  onRemove?: () => void;
  className?: string;
  display?: "chip" | "image-only";
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type FileIconName = "image" | "code" | "data" | "text";

function getFileIconName(filename: string, isImage?: boolean): FileIconName {
  if (isImage) return "image";
  const ext = filename.split(".").pop()?.toLowerCase();
  if (
    [
      "js",
      "ts",
      "jsx",
      "tsx",
      "py",
      "rb",
      "go",
      "rs",
      "java",
      "kt",
      "swift",
      "c",
      "cpp",
      "h",
      "hpp",
      "cs",
      "php",
    ].includes(ext || "")
  ) {
    return "code";
  }
  if (["json", "yaml", "yml", "xml"].includes(ext || "")) return "data";
  return "text";
}

function renderFileIcon(iconName: FileIconName) {
  const cls = "size-4 text-neutral-500 dark:text-neutral-400";
  switch (iconName) {
    case "image":
      return <ImageIcon className={cls} />;
    case "code":
      return <FileCode className={cls} />;
    case "data":
      return <FileJson className={cls} />;
    default:
      return <FileText className={cls} />;
  }
}

export function FileAttachment({
  id,
  filename,
  size,
  isImage,
  url,
  onRemove,
  className,
  display = "chip",
}: FileAttachmentProps) {
  const [isHovered, setIsHovered] = useState(false);
  const iconName = getFileIconName(filename, isImage);
  const isImageOnly = display === "image-only" && isImage && !!url;

  return (
    <div
      data-attachment-id={id}
      className={cn(
        "relative bg-neutral-100/80 dark:bg-neutral-800/60 rounded-[6px]",
        isImageOnly
          ? "size-10 flex items-center justify-center"
          : "flex items-center gap-2 pl-1 pr-2 py-1 min-w-[120px] max-w-[200px]",
        className,
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {isImageOnly ? (
        <div className="size-8 overflow-hidden shrink-0 rounded-[4px]">
          <img
            src={url}
            alt={filename}
            className="w-full h-full object-cover"
          />
        </div>
      ) : (
        <>
          {isImage && url ? (
            <div className="w-8 self-stretch overflow-hidden shrink-0 rounded-[4px]">
              <img
                src={url}
                alt={filename}
                className="w-full h-full object-cover aspect-square"
              />
            </div>
          ) : (
            <div className="flex items-center justify-center w-8 self-stretch bg-neutral-200 dark:bg-neutral-700 shrink-0 rounded-[4px]">
              {renderFileIcon(iconName)}
            </div>
          )}

          <div className="flex flex-col min-w-0">
            <span
              className="text-sm font-medium text-neutral-900 dark:text-neutral-100 truncate"
              title={filename}
            >
              {filename}
            </span>
            {size !== undefined && (
              <span className="text-[10px] text-neutral-500 dark:text-neutral-400">
                {formatFileSize(size)}
              </span>
            )}
          </div>
        </>
      )}

      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className={cn(
            "absolute -top-1.5 -right-1.5 size-4 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700",
            "flex items-center justify-center transition-[opacity,transform] duration-150 ease-out active:scale-[0.97] z-10",
            "text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100",
            isHovered ? "opacity-100" : "opacity-0",
          )}
          type="button"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}
