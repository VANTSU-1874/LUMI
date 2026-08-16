"use client";

import Link from "next/link";
import Image from "next/image";
import {
  BookmarkIcon,
  CheckIcon,
  ChevronLeftIcon,
  ExternalLinkIcon,
  ImageIcon,
  LibraryBigIcon,
  SearchIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Masonry from "@/components/Masonry";
import { RulerCarousel, type CarouselItem } from "@/components/ruler-carousel";
import { searchInspirationEntries } from "./inspiration-search-state";
import type {
  InspirationArtwork,
  InspirationEntries,
  InspirationEntry,
} from "./inspiration-wiki-data";
import { InspirationBrowseResponseSchema, type InspirationBrowseItem } from "@/lib/domain/inspiration-browser";
import { WikiMultimodalSearchResponseSchema } from "@/lib/domain/inspiration-wiki/multimodal-retrieval-contracts";
import styles from "./inspiration-wiki.module.css";

const topics = ["全部", "构成", "网格", "字体", "色彩", "材质", "动势", "系统"] as const;
type Topic = (typeof topics)[number];
const topicItems: CarouselItem[] = topics.map((topic) => ({ id: topic, title: topic }));

function stableCardHeight(entry: InspirationEntry) {
  const seed = [...entry.id].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const descriptionRows = Math.min(3, Math.ceil(entry.description.length / 42));
  const topicRows = Math.ceil(Math.min(entry.topics.length, 4) / 2);
  return 438 + descriptionRows * 22 + topicRows * 24 + (seed % 3) * 18;
}

function InspirationArtwork({
  artwork,
  alt,
}: {
  artwork: InspirationArtwork;
  alt: string;
}) {
  const props = {
    "aria-label": alt,
    className: styles.artwork,
    preserveAspectRatio: "xMidYMid slice",
    role: "img",
    viewBox: "0 0 800 620",
  } as const;

  if (artwork === "balance") return <svg {...props}>
    <rect width="800" height="620" fill="#E9E1D1" />
    <rect x="70" y="72" width="660" height="476" rx="8" fill="#F6F1E7" stroke="#B9AEA0" strokeWidth="2" />
    <path d="M70 484H730" stroke="#B23A2F" strokeWidth="6" />
    <circle cx="256" cy="310" r="171" fill="#24221F" />
    <path d="M88 312C184 287 287 321 378 474" stroke="#D5C9B8" strokeWidth="32" />
    <circle cx="542" cy="182" r="65" fill="#B23A2F" />
    <circle cx="598" cy="422" r="25" fill="#24221F" />
    <path d="M492 196V470M512 196V470M532 196V470M552 196V470M572 196V470M592 196V470M612 196V470M632 196V470" stroke="#6E685F" strokeWidth="3" />
  </svg>;

  if (artwork === "rhythm") return <svg {...props}>
    <rect width="800" height="620" fill="#E7DED0" />
    <rect x="76" y="76" width="648" height="468" fill="#F8F4EB" />
    <rect x="132" y="142" width="104" height="342" fill="#24221F" />
    <rect x="268" y="142" width="22" height="342" fill="#C04835" />
    <rect x="322" y="142" width="208" height="84" fill="#D8B79B" />
    <rect x="322" y="256" width="338" height="46" fill="#24221F" />
    <rect x="322" y="332" width="246" height="28" fill="#24221F" />
    <rect x="322" y="390" width="294" height="14" fill="#766F65" />
    <rect x="322" y="430" width="168" height="14" fill="#766F65" />
    <path d="M670 142V484M686 142V484M702 142V484" stroke="#B23A2F" strokeWidth="4" />
  </svg>;

  if (artwork === "layers") return <svg {...props}>
    <rect width="800" height="620" fill="#232220" />
    <path d="M94 120H708V496H94V120Z" fill="#151513" stroke="#7D766C" strokeWidth="2" />
    <path d="M192 412C192 292 288 194 406 194C524 194 620 292 620 412" stroke="#EFE6D5" strokeWidth="70" />
    <path d="M192 420C192 300 288 202 406 202C524 202 620 300 620 420" stroke="#B23A2F" strokeWidth="15" />
    <rect x="140" y="126" width="118" height="118" fill="#EFE6D5" />
    <rect x="542" y="372" width="118" height="118" fill="#EFE6D5" />
    <path d="M116 510H676" stroke="#EFE6D5" strokeWidth="4" />
  </svg>;

  if (artwork === "grid") return <svg {...props}>
    <rect width="800" height="620" fill="#F2ECE0" />
    <g stroke="#B9B1A5" strokeWidth="2">
      <path d="M80 80H720V540H80V80Z" />
      <path d="M186 80V540M293 80V540M400 80V540M507 80V540M614 80V540" />
      <path d="M80 172H720M80 264H720M80 356H720M80 448H720" />
    </g>
    <rect x="187" y="173" width="212" height="182" fill="#252320" />
    <circle cx="560" cy="218" r="78" fill="#B23A2F" />
    <path d="M402 357H614V540H402V357Z" fill="#DCC8AC" />
    <path d="M80 448H292V540H80V448Z" fill="#6D766F" />
    <circle cx="347" cy="402" r="26" fill="#252320" />
  </svg>;

  if (artwork === "fold") return <svg {...props}>
    <rect width="800" height="620" fill="#C8B79F" />
    <rect x="96" y="70" width="608" height="480" rx="8" fill="#D9C8B1" />
    <path d="M216 146L578 166L620 412L336 492L176 354L216 146Z" fill="#F7F2E8" />
    <path d="M216 146L420 304L336 492L176 354L216 146Z" fill="#E4D8C6" />
    <path d="M420 304L578 166L620 412L336 492L420 304Z" fill="#B9A58A" />
    <path d="M420 304L336 492" stroke="#796E5F" strokeWidth="4" />
    <path d="M420 304L216 146" stroke="#796E5F" strokeWidth="4" />
    <circle cx="590" cy="118" r="23" fill="#B23A2F" />
  </svg>;

  if (artwork === "motion") return <svg {...props}>
    <rect width="800" height="620" fill="#1E211F" />
    <g fill="#E8E0D0">
      <rect x="98" y="98" width="134" height="424" rx="8" />
      <rect x="260" y="98" width="134" height="424" rx="8" />
      <rect x="422" y="98" width="134" height="424" rx="8" />
      <rect x="584" y="98" width="118" height="424" rx="8" />
    </g>
    <path d="M119 432C150 278 174 204 212 160" stroke="#252320" strokeWidth="26" />
    <path d="M278 450C307 302 343 212 377 154" stroke="#252320" strokeWidth="26" />
    <path d="M440 468C468 326 504 212 540 142" stroke="#252320" strokeWidth="26" />
    <path d="M600 484C633 342 660 204 688 116" stroke="#252320" strokeWidth="26" />
    <circle cx="194" cy="160" r="20" fill="#B23A2F" />
    <circle cx="358" cy="154" r="20" fill="#B23A2F" />
    <circle cx="520" cy="142" r="20" fill="#B23A2F" />
    <circle cx="672" cy="116" r="20" fill="#B23A2F" />
  </svg>;

  if (artwork === "contrast") return <svg {...props}>
    <rect width="800" height="620" fill="#E8E2D8" />
    <rect x="74" y="72" width="652" height="476" fill="#F8F4EC" />
    <rect x="74" y="72" width="252" height="476" fill="#B23A2F" />
    <path d="M326 548V318C326 191 429 88 556 88C683 88 726 191 726 318V548H326Z" fill="#252320" />
    <circle cx="506" cy="282" r="121" fill="#E7D5B6" />
    <path d="M620 116V492M636 116V492M652 116V492M668 116V492" stroke="#E7D5B6" strokeWidth="3" />
  </svg>;

  return <svg {...props}>
    <rect width="800" height="620" fill="#EFE9DE" />
    <path d="M400 84V536M108 310H692" stroke="#BEB5A8" strokeWidth="2" />
    <path d="M400 126C427 216 495 280 592 310C495 340 427 404 400 494C373 404 305 340 208 310C305 280 373 216 400 126Z" fill="#252320" />
    <path d="M400 170C419 234 467 281 538 310C467 339 419 386 400 450C381 386 333 339 262 310C333 281 381 234 400 170Z" fill="#B23A2F" />
    <circle cx="400" cy="310" r="40" fill="#EFE9DE" />
    <circle cx="120" cy="104" r="24" fill="#B23A2F" />
    <circle cx="680" cy="516" r="24" fill="#252320" />
  </svg>;
}

type InspirationWikiProps = {
  embedded?: boolean;
  showEmbeddedTopbar?: boolean;
  entries?: InspirationEntries;
  initialSelectedId?: string;
  onBackToChat?: () => void;
  onToggleSaved?: (entryId: string) => void;
  onUseInChat?: (entry: InspirationEntry) => void;
  savedEntryIds?: readonly string[];
  fetcher?: typeof fetch;
};

function placeholderArtwork(id: string): InspirationArtwork {
  const artwork: InspirationArtwork[] = ["balance", "rhythm", "layers", "grid", "fold", "motion", "contrast", "marks"];
  return artwork[[...id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % artwork.length]!;
}

function ControlledPreview({ entry }: { entry: InspirationEntry }) {
  const previewIdentity = `${entry.id}:${entry.protectedPreviewUrl ?? ""}`;
  const [failedPreviewIdentity, setFailedPreviewIdentity] = useState<string | null>(null);
  const failed = failedPreviewIdentity === previewIdentity;
  if (!entry.protectedPreviewUrl || failed) return <span className={styles.metadataPreview} aria-label={`${entry.title} 的安全预览不可用`}><small>已审核案例</small><strong>安全预览不可用</strong><em>仍可查看来源、标签与课程关联</em></span>;
  return <Image alt={`${entry.title} 的受保护预览`} className={styles.controlledPreview} height={620} onError={() => setFailedPreviewIdentity(previewIdentity)} src={entry.protectedPreviewUrl} unoptimized width={800} />;
}

function liveEntry(item: InspirationBrowseItem): InspirationEntry {
  const association = item.courseAssociations[0];
  const topics = item.tags.length ? item.tags : association?.facets.length ? association.facets : ["已审核案例"];
  return {
    id: item.id, title: item.title, subtitle: association ? `${association.coursePackId} · 已审核案例` : "已审核案例",
    description: item.description ?? "该案例目前以可展示的来源与标签元数据供浏览。",
    observation: "此案例当前仅提供受控元数据浏览，不交付私有资源或未批准预览。",
    relation: association ? `课程关联：${association.facets.join("、")}` : "可作为独立视觉案例继续讨论。",
    topics, medium: item.preview === "METADATA_ONLY" ? "元数据案例" : "案例", course: association?.coursePackId ?? "灵感 Wiki",
    artwork: placeholderArtwork(item.id), alt: `${item.title} 的受控元数据案例占位图。`, aspect: "square",
    source: item.source.label, sourceUrl: item.source.url, license: item.attributionNotice, updated: "已入库", related: [], metadataOnly: item.preview === "METADATA_ONLY", protectedPreviewUrl: item.previewUrl,
  };
}

export function InspirationWiki(props: InspirationWikiProps) {
  return props.entries ? <InspirationWikiContents {...props} entries={props.entries} /> : <LiveInspirationWiki {...props} />;
}

function LiveInspirationWiki({ fetcher = fetch, ...props }: Omit<InspirationWikiProps, "entries">) {
  const [query, setQuery] = useState("");
  const [queryImage, setQueryImage] = useState<File | null>(null);
  const [topic, setTopic] = useState<Topic>("全部");
  const [items, setItems] = useState<InspirationBrowseItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [appliedFacets, setAppliedFacets] = useState<string[]>([]);
  const [status, setStatus] = useState<"LOADING" | "READY" | "ERROR">("LOADING");
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retrievalNotice, setRetrievalNotice] = useState<string | null>(null);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [resolvedRequestKey, setResolvedRequestKey] = useState<string | null>(null);
  const requestId = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);
  const requestKey = JSON.stringify([query, topic, queryImage?.name ?? null, queryImage?.size ?? null, queryImage?.lastModified ?? null, reloadVersion]);

  const requestPage = useCallback(async (cursor: string | null) => {
    if (query.trim() || queryImage) {
      const form = new FormData();
      if (query.trim()) form.set("query", query.trim());
      if (topic !== "全部") form.set("topic", topic);
      if (queryImage) form.set("image", queryImage);
      const response = await fetcher("/api/inspiration/multimodal-search", { method: "POST", body: form, cache: "no-store" });
      const payload: unknown = await response.json();
      if (!response.ok) throw new Error(typeof payload === "object" && payload && "error" in payload && typeof payload.error === "string" ? payload.error : "灵感检索失败");
      const parsed = WikiMultimodalSearchResponseSchema.parse(payload);
      return { items: parsed.items, nextCursor: null, appliedFacets: parsed.appliedFacets, retrievalNotice: parsed.retrieval.notice };
    }
    const params = new URLSearchParams({ limit: "12" });
    if (topic !== "全部") params.set("topic", topic);
    if (cursor) params.set("cursor", cursor);
    const response = await fetcher(`/api/inspiration/browse?${params}`, { cache: "no-store" });
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error(typeof payload === "object" && payload && "error" in payload && typeof payload.error === "string" ? payload.error : "灵感案例加载失败");
    return { ...InspirationBrowseResponseSchema.parse(payload), retrievalNotice: null };
  }, [fetcher, query, queryImage, topic]);
  const currentStatus = resolvedRequestKey === requestKey ? status : "LOADING";

  useEffect(() => {
    const sequence = ++requestId.current;
    let cancelled = false;
    void requestPage(null).then((parsed) => {
      if (cancelled || sequence !== requestId.current) return;
      setItems(parsed.items); setNextCursor(parsed.nextCursor); setAppliedFacets(parsed.appliedFacets);
      setRetrievalNotice(parsed.retrievalNotice);
      setStatus("READY"); setError(null); setLoadingMore(false); setResolvedRequestKey(requestKey);
    }).catch((caught: unknown) => {
      if (cancelled || sequence !== requestId.current) return;
      setStatus("ERROR"); setError(caught instanceof Error ? caught.message : "灵感案例加载失败"); setLoadingMore(false); setResolvedRequestKey(requestKey);
    });
    return () => { cancelled = true; };
  }, [requestKey, requestPage]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    const sequence = ++requestId.current;
    setLoadingMore(true);
    try {
      const parsed = await requestPage(nextCursor);
      if (sequence !== requestId.current) return;
      setItems((current) => [...current, ...parsed.items.filter((entry) => !current.some((known) => known.id === entry.id))]);
      setNextCursor(parsed.nextCursor); setAppliedFacets(parsed.appliedFacets); setRetrievalNotice(parsed.retrievalNotice); setStatus("READY"); setError(null);
    } catch (caught) {
      if (sequence === requestId.current) { setStatus("ERROR"); setError(caught instanceof Error ? caught.message : "灵感案例加载失败"); }
    } finally { if (sequence === requestId.current) setLoadingMore(false); }
  }, [nextCursor, requestPage]);

  const retry = useCallback(() => setReloadVersion((current) => current + 1), []);
  useEffect(() => {
    if (!nextCursor || !sentinel.current || currentStatus !== "READY") return;
    const observer = new IntersectionObserver(([entry]) => { if (entry?.isIntersecting && !loadingMore) void loadMore(); }, { rootMargin: "320px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [currentStatus, loadMore, loadingMore, nextCursor]);

  if (currentStatus === "LOADING") return <BrowserState embedded={props.embedded} kind="loading" onBackToChat={props.onBackToChat} showEmbeddedTopbar={props.showEmbeddedTopbar} />;
  if (currentStatus === "ERROR") return <BrowserState embedded={props.embedded} error={error} kind="error" onBackToChat={props.onBackToChat} onRetry={retry} showEmbeddedTopbar={props.showEmbeddedTopbar} />;
  const entries = items.map(liveEntry);
  return <><InspirationWikiContents {...props} appliedFacets={appliedFacets} controlledQuery={query} controlledTopic={topic} entries={entries as unknown as InspirationEntries} imageQueryName={queryImage?.name ?? null} onImageQueryChange={setQueryImage} onQueryChange={setQuery} onTopicChange={setTopic} retrievalNotice={retrievalNotice} serverSearch />
    <div aria-live="polite" className={styles.loadMore} ref={sentinel}>{loadingMore ? "正在加载更多案例…" : nextCursor ? <button onClick={() => void loadMore()} type="button">继续浏览更多案例</button> : "已显示全部可浏览案例"}</div>
  </>;
}

function InspirationSurfaceTopbar({ embedded, onBackToChat, serverSearch, showEmbeddedTopbar = true }: Pick<InspirationWikiProps, "embedded" | "onBackToChat" | "showEmbeddedTopbar"> & { serverSearch: boolean }) {
  if (embedded && !showEmbeddedTopbar) return null;
  return embedded ? <header className={styles.embeddedTopbar}>
    <button className={styles.backLink} onClick={onBackToChat} type="button">
      <ChevronLeftIcon aria-hidden="true" size={16} />
      <span>返回对话</span>
    </button>
    <div>
      <p>灵感 Wiki</p>
      <span>浏览已策展案例，也可带回当前对话继续讨论</span>
    </div>
    <p className={styles.topbarNote}>{serverSearch ? "已审核案例浏览" : "本地合规示意"}</p>
  </header> : <header className={styles.topbar}>
    <Link className={styles.backLink} href="/student">
      <ChevronLeftIcon aria-hidden="true" size={16} />
      <span>返回工作台</span>
    </Link>
    <Link aria-label="返回 Lumi 首页" className={styles.wordmark} href="/">
      <span aria-hidden="true">✦</span>
      <strong>LUMI</strong>
      <small>灵感 Wiki</small>
    </Link>
    <p className={styles.topbarNote}>可核对设计参考 · 本地合规示意</p>
  </header>;
}

function BrowserState({ embedded, error, kind, onBackToChat, onRetry, showEmbeddedTopbar }: Pick<InspirationWikiProps, "embedded" | "onBackToChat" | "showEmbeddedTopbar"> & { error?: string | null; kind: "loading" | "empty" | "error"; onRetry?: () => void }) {
  const message = kind === "loading" ? "正在加载已审核的灵感案例…" : kind === "empty" ? "暂无可浏览的已审核案例" : error ?? "灵感案例暂时不可用";
  return <main className={styles.page} data-embedded={embedded || undefined} data-search-state={kind}>
    <InspirationSurfaceTopbar embedded={embedded} onBackToChat={onBackToChat} serverSearch showEmbeddedTopbar={showEmbeddedTopbar} />
    <div className={styles.wikiWorkspace}>
      <RulerCarousel ariaLabel="案例分类" className={styles.wikiRuler} initialItemId="全部" originalItems={topicItems} />
      <div className={styles.wikiSearchRow}>
        <label className={styles.wikiSearch}>
          <SearchIcon aria-hidden="true" size={16} />
          <span className="sr-only">搜索灵感资料</span>
          <input disabled placeholder="搜索案例、标签或来源" type="search" />
        </label>
        <span aria-live="polite" className={styles.wikiCount}>0 个正式案例</span>
      </div>
      <section className={styles.wikiStatus} aria-live="polite" data-kind={kind}>
        <LibraryBigIcon aria-hidden="true" size={26} />
        <h1>{message}</h1>
        <p>{kind === "error" ? "请重试；不会以演示数据替代真实结果。" : "案例通过学生展示门禁后会直接进入这组瀑布流。"}</p>
        {onRetry ? <button onClick={onRetry} type="button">重新读取</button> : null}
      </section>
    </div>
  </main>;
}

function InspirationWikiContents({
  appliedFacets: serverAppliedFacets,
  controlledQuery,
  controlledTopic,
  entries,
  onQueryChange,
  onTopicChange,
  imageQueryName,
  onImageQueryChange,
  retrievalNotice,
  serverSearch = false,
  showEmbeddedTopbar,
  ...props
}: InspirationWikiProps & {
  entries: InspirationEntries;
  appliedFacets?: string[];
  controlledQuery?: string;
  controlledTopic?: Topic;
  onQueryChange?: (value: string) => void;
  onTopicChange?: (value: Topic) => void;
  imageQueryName?: string | null;
  onImageQueryChange?: (value: File | null) => void;
  retrievalNotice?: string | null;
  serverSearch?: boolean;
}) {
  const { embedded = false, onBackToChat, onToggleSaved, onUseInChat, savedEntryIds } = props;
  const [localQuery, setLocalQuery] = useState("");
  const [localTopic, setLocalTopic] = useState<Topic>("全部");
  const query = controlledQuery ?? localQuery;
  const activeTopic = controlledTopic ?? localTopic;
  const setQuery = onQueryChange ?? setLocalQuery;
  const setActiveTopic = onTopicChange ?? setLocalTopic;
  const [localSavedIds, setLocalSavedIds] = useState<Set<string>>(() => new Set());
  const imageInput = useRef<HTMLInputElement>(null);
  const savedIds = useMemo(() => new Set(savedEntryIds ?? localSavedIds), [localSavedIds, savedEntryIds]);
  const localSearchResult = useMemo(() => searchInspirationEntries(entries, query, activeTopic), [activeTopic, entries, query]);
  const searchResult = serverSearch
    ? { ...localSearchResult, entries: [...entries], appliedFacets: serverAppliedFacets ?? [], state: query || imageQueryName ? "SEARCH_INTENT" as const : "BROWSE_DEFAULT" as const }
    : localSearchResult;
  const visibleEntries = searchResult.entries;
  const masonryItems = useMemo(() => visibleEntries.map((entry, index) => ({
    entry,
    height: stableCardHeight(entry),
    id: entry.id,
    itemIndex: index,
  })), [visibleEntries]);

  function toggleSaved(id: string) {
    if (onToggleSaved) {
      onToggleSaved(id);
      return;
    }
    setLocalSavedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <main className={styles.page} data-embedded={embedded || undefined} data-search-state={searchResult.state}>
      <InspirationSurfaceTopbar embedded={embedded} onBackToChat={onBackToChat} serverSearch={serverSearch} showEmbeddedTopbar={showEmbeddedTopbar} />
      <div className={styles.wikiWorkspace}>
        <RulerCarousel
          ariaLabel="案例分类"
          className={styles.wikiRuler}
          initialItemId={activeTopic}
          key={activeTopic}
          onValueChange={(item) => setActiveTopic(item.id as Topic)}
          originalItems={topicItems}
        />

        <section className={styles.wikiSearchRow} aria-label="搜索灵感资料">
          <label className={styles.wikiSearch}>
            <SearchIcon aria-hidden="true" size={16} />
            <span className="sr-only">搜索灵感资料</span>
            <input
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="搜索案例、标签或来源"
              type="search"
              value={query}
            />
            {query ? <button aria-label="清空搜索" onClick={() => setQuery("")} type="button"><XIcon aria-hidden="true" size={15} /></button> : null}
          </label>
          {serverSearch ? <>
            <input
              accept="image/jpeg,image/png,image/webp"
              aria-label="选择检索图片"
              className={styles.wikiImageInput}
              onChange={(event) => onImageQueryChange?.(event.currentTarget.files?.[0] ?? null)}
              ref={imageInput}
              type="file"
            />
            <button
              aria-label="选择图片查找相似作品"
              className={styles.wikiImageSearchButton}
              data-active={imageQueryName ? true : undefined}
              onClick={() => imageInput.current?.click()}
              title="以图片搜索"
              type="button"
            ><ImageIcon aria-hidden="true" size={17} /><span>图片</span></button>
          </> : null}
          <span aria-live="polite" className={styles.wikiCount}>{visibleEntries.length} 个正式案例</span>
        </section>

        {imageQueryName ? <div className={styles.wikiImageQuery}>
          <ImageIcon aria-hidden="true" size={15} />
          <span title={imageQueryName}>{imageQueryName}</span>
          <button aria-label="移除检索图片" onClick={() => { if (imageInput.current) imageInput.current.value = ""; onImageQueryChange?.(null); }} type="button"><XIcon aria-hidden="true" size={14} /></button>
        </div> : null}

        {retrievalNotice ? <p aria-live="polite" className={styles.wikiRetrievalNote}>{retrievalNotice}</p> : null}

        {searchResult.appliedFacets.length ? (
          <p className={styles.wikiFacetNote}>已识别：{searchResult.appliedFacets.join(" · ")}</p>
        ) : null}

        {visibleEntries.length ? (
          <div className={styles.wikiMasonry}>
            <Masonry
              animateFrom="bottom"
              ariaLabel="灵感案例"
              blurToFocus
              colorShiftOnHover={false}
              duration={0.45}
              ease="power3.out"
              hoverScale={0.98}
              items={masonryItems}
              renderItem={({ entry, itemIndex }: { entry: InspirationEntry; itemIndex: number }) => {
                const saved = savedIds.has(entry.id);
                return (
                  <article className={styles.wikiCard} data-aspect={entry.aspect}>
                    <div className={styles.wikiCardMedia}>
                      {entry.protectedPreviewUrl ? <ControlledPreview entry={entry} /> : entry.metadataOnly ? (
                        <span className={styles.metadataPreview} aria-label={entry.alt}>
                          <small>已审核案例</small>
                          <strong>{entry.topics.slice(0, 2).join(" · ")}</strong>
                          <em>仅展示受控元数据</em>
                        </span>
                      ) : <InspirationArtwork alt={entry.alt} artwork={entry.artwork} />}
                      <span className={styles.wikiCardIndex}>{String(itemIndex + 1).padStart(2, "0")}</span>
                      <button
                        aria-label={saved ? `从当前画板移除：${entry.title}` : `加入当前画板：${entry.title}`}
                        aria-pressed={saved}
                        className={styles.wikiSaveButton}
                        data-saved={saved || undefined}
                        onClick={() => toggleSaved(entry.id)}
                        type="button"
                      >
                        {saved ? <CheckIcon aria-hidden="true" size={15} /> : <BookmarkIcon aria-hidden="true" size={15} />}
                      </button>
                    </div>
                    <div className={styles.wikiCardBody}>
                      <p className={styles.wikiCardMeta}>{entry.course} · {entry.medium}</p>
                      <h2>{entry.title}</h2>
                      <p className={styles.wikiCardDescription}>{entry.description}</p>
                      <ul className={styles.wikiCardInsights}>
                        <li>{entry.observation}</li>
                        <li>{entry.relation}</li>
                      </ul>
                      <div className={styles.wikiCardTags} aria-label="案例标签">
                        {entry.topics.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}
                      </div>
                      <div className={styles.wikiDisclosure}>
                        <span>来源：{entry.sourceUrl ? <a href={entry.sourceUrl} rel="noreferrer" target="_blank">{entry.source}</a> : entry.source}</span>
                        <span>许可：{entry.license}</span>
                      </div>
                      {onUseInChat ? (
                        <button className={styles.wikiUseButton} onClick={() => onUseInChat(entry)} type="button">
                          <span>带回当前对话</span>
                          <ExternalLinkIcon aria-hidden="true" size={14} />
                        </button>
                      ) : (
                        <Link className={styles.wikiUseButton} href={`/student?inspirationCase=${encodeURIComponent(entry.id)}`}>
                          <span>带着案例问 Lumi</span>
                          <ExternalLinkIcon aria-hidden="true" size={14} />
                        </Link>
                      )}
                    </div>
                  </article>
                );
              }}
              scaleOnHover
              stagger={0.03}
            />
          </div>
        ) : (
          <section className={styles.wikiStatus} aria-live="polite">
            <SearchIcon aria-hidden="true" size={24} />
            <h2>{query || imageQueryName || activeTopic !== "全部" ? "还没有匹配的灵感条目" : "暂无可浏览的已审核案例"}</h2>
            <p>{query || imageQueryName || activeTopic !== "全部" ? "换一个更宽的描述、另一张图片，或清空筛选后继续浏览。" : "案例通过学生展示门禁后会直接进入这组瀑布流。"}</p>
            {query || imageQueryName || activeTopic !== "全部" ? <button onClick={() => { setActiveTopic("全部"); setQuery(""); if (imageInput.current) imageInput.current.value = ""; onImageQueryChange?.(null); }} type="button">清空筛选</button> : null}
          </section>
        )}
      </div>
    </main>
  );
}
