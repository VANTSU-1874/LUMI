"use client";

import { useAui, useAuiState } from "@assistant-ui/react";
import {
  ArchiveIcon,
  CheckIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  Share2Icon,
  Trash2Icon,
} from "lucide-react";
import { type FormEvent, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import styles from "./assistant-lab.module.css";

export function LabThreadHeader() {
  const aui = useAui();
  const title = useAuiState((state) => state.threadListItem.title ?? "新对话");
  const id = useAuiState((state) => state.threadListItem.id);
  const remoteId = useAuiState((state) => state.threadListItem.remoteId);
  const custom = useAuiState((state) => state.threadListItem.custom);
  const threadId = remoteId ?? id;
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const [renameValue, setRenameValue] = useState(title);
  const [copyStatus, setCopyStatus] = useState("分享");
  const pinned = custom?.pinned === true;

  const togglePinned = () => {
    const update = aui.threadListItem().updateCustom({ ...custom, pinned: !pinned });
    void Promise.resolve(update)
      .then(() => aui.threads().reload())
      .catch(() => undefined);
  };

  const copyShareLink = async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("thread", threadId);
    url.hash = "";
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopyStatus("已复制");
    } catch {
      setCopyStatus("复制失败");
    }
    window.setTimeout(() => setCopyStatus("分享"), 1400);
  };

  const renameThread = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextTitle = renameValue.trim();
    if (!nextTitle) return;
    aui.threadListItem().rename(nextTitle);
    setDialog(null);
  };

  return (
    <>
      <div className={styles.topbarSpacer} aria-hidden="true" />

      <div className={styles.threadHeaderActions}>
        <button
          aria-label="分享当前内容"
          className={styles.topbarTextButton}
          onClick={() => void copyShareLink()}
          title="分享"
          type="button"
        >
          {copyStatus === "已复制" ? (
            <CheckIcon aria-hidden="true" size={16} />
          ) : (
            <Share2Icon aria-hidden="true" size={16} />
          )}
          <span>{copyStatus}</span>
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                aria-label="更多对话操作"
                className={styles.topbarIconButton}
                title="更多"
                type="button"
              />
            }
          >
            <MoreHorizontalIcon aria-hidden="true" size={19} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={styles.threadMenu} sideOffset={5}>
            <DropdownMenuItem
              className={styles.threadMenuItem}
              onClick={() => {
                setRenameValue(title);
                setDialog("rename");
              }}
            >
              <PencilIcon aria-hidden="true" size={17} />
              <span>重命名</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={styles.threadMenuItem}
              onClick={togglePinned}
            >
              {pinned ? <PinOffIcon aria-hidden="true" size={17} /> : <PinIcon aria-hidden="true" size={17} />}
              <span>{pinned ? "取消置顶" : "置顶对话"}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className={styles.menuSeparator} />
            <DropdownMenuItem
              className={styles.threadMenuItem}
              onClick={() => aui.threadListItem().archive()}
            >
              <ArchiveIcon aria-hidden="true" size={17} />
              <span>归档</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              className={`${styles.threadMenuItem} ${styles.threadMenuDanger}`}
              onClick={() => setDialog("delete")}
            >
              <Trash2Icon aria-hidden="true" size={17} />
              <span>删除</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Dialog onOpenChange={(open) => !open && setDialog(null)} open={dialog === "rename"}>
        <DialogContent className={styles.compactDialog}>
          <DialogTitle className={styles.compactDialogTitle}>重命名对话</DialogTitle>
          <form className={styles.threadDialogForm} onSubmit={renameThread}>
            <input
              aria-label="新对话名称"
              autoFocus
              onChange={(event) => setRenameValue(event.currentTarget.value)}
              value={renameValue}
            />
            <div className={styles.dialogActions}>
              <button onClick={() => setDialog(null)} type="button">取消</button>
              <button disabled={!renameValue.trim()} type="submit">保存</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={(open) => !open && setDialog(null)} open={dialog === "delete"}>
        <DialogContent className={styles.compactDialog}>
          <DialogTitle className={styles.compactDialogTitle}>删除这条对话？</DialogTitle>
          <DialogDescription className={styles.compactDialogDescription}>
            删除后，对话、消息与对应运行记录都会一并移除。
          </DialogDescription>
          <div className={styles.dialogActions}>
            <button onClick={() => setDialog(null)} type="button">取消</button>
            <button
              className={styles.dangerButton}
              onClick={() => {
                aui.threadListItem().delete();
                setDialog(null);
              }}
              type="button"
            >
              删除
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
