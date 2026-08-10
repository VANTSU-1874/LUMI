"use client";

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  Share2Icon,
  Trash2Icon,
} from "lucide-react";
import { useAui, useAuiState } from "@assistant-ui/react";
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

type ThreadDialog = "share" | "rename" | "delete" | null;

export function LabThreadMoreMenu({ archived = false }: { archived?: boolean }) {
  const aui = useAui();
  const id = useAuiState((state) => state.threadListItem.id);
  const remoteId = useAuiState((state) => state.threadListItem.remoteId);
  const title = useAuiState((state) => state.threadListItem.title ?? "新对话");
  const custom = useAuiState((state) => state.threadListItem.custom);
  const threadId = remoteId ?? id;
  const [dialog, setDialog] = useState<ThreadDialog>(null);
  const [renameValue, setRenameValue] = useState(title);
  const [shareUrl, setShareUrl] = useState("");
  const [copyStatus, setCopyStatus] = useState("复制链接");
  const pinned = custom?.pinned === true;

  const togglePinned = () => {
    const update = aui.threadListItem().updateCustom({ ...custom, pinned: !pinned });
    void Promise.resolve(update)
      .then(() => aui.threads().reload())
      .catch(() => undefined);
  };

  const openShareDialog = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("thread", threadId);
    url.hash = "";
    setShareUrl(url.toString());
    setCopyStatus("复制链接");
    setDialog("share");
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
      <div className={styles.threadItemControls}>
        <span
          aria-label={pinned ? "已置顶" : undefined}
          className={styles.threadPinIndicator}
          data-visible={pinned}
          title={pinned ? "已置顶" : undefined}
        >
          <PinIcon aria-hidden="true" size={13} />
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                aria-label={`更多设置：${title}`}
                className={styles.threadMoreButton}
                title="更多"
                type="button"
              />
            }
          >
            <MoreHorizontalIcon aria-hidden="true" size={17} />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className={styles.threadMenu}
            side="right"
            sideOffset={5}
          >
            <DropdownMenuItem className={styles.threadMenuItem} onClick={openShareDialog}>
              <Share2Icon aria-hidden="true" size={17} />
              <span>分享</span>
            </DropdownMenuItem>
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
              onClick={() => archived
                ? aui.threadListItem().unarchive()
                : aui.threadListItem().archive()}
            >
              {archived ? <ArchiveRestoreIcon aria-hidden="true" size={17} /> : <ArchiveIcon aria-hidden="true" size={17} />}
              <span>{archived ? "恢复对话" : "归档"}</span>
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

      <Dialog onOpenChange={(open) => !open && setDialog(null)} open={dialog === "share"}>
        <DialogContent className={styles.compactDialog}>
          <DialogTitle className={styles.compactDialogTitle}>分享对话</DialogTitle>
          <DialogDescription className={styles.compactDialogDescription}>
            拥有访问权限的账号可通过此链接打开这条对话。
          </DialogDescription>
          <div className={styles.shareField}>
            <input aria-label="对话链接" readOnly value={shareUrl} />
            <button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(shareUrl);
                  setCopyStatus("已复制");
                } catch {
                  setCopyStatus("复制失败");
                }
              }}
              type="button"
            >
              {copyStatus}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={(open) => !open && setDialog(null)} open={dialog === "rename"}>
        <DialogContent className={styles.compactDialog} showCloseButton={false}>
          <form className={styles.threadDialogForm} onSubmit={renameThread}>
            <DialogTitle className={styles.compactDialogTitle}>重命名对话</DialogTitle>
            <DialogDescription className="sr-only">输入新的对话名称。</DialogDescription>
            <input
              aria-label="对话名称"
              autoFocus
              onChange={(event) => setRenameValue(event.currentTarget.value)}
              value={renameValue}
            />
            <div className={styles.compactDialogActions}>
              <button onClick={() => setDialog(null)} type="button">取消</button>
              <button disabled={!renameValue.trim()} type="submit">保存</button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog onOpenChange={(open) => !open && setDialog(null)} open={dialog === "delete"}>
        <DialogContent className={styles.compactDialog} showCloseButton={false}>
          <DialogTitle className={styles.compactDialogTitle}>删除“{title}”？</DialogTitle>
          <DialogDescription className={styles.compactDialogDescription}>
            这会删除对话、消息与对应运行记录，无法撤销。
          </DialogDescription>
          <div className={styles.compactDialogActions}>
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
