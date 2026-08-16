import Link from "next/link";
import {
  BookOpenCheckIcon,
  ExternalLinkIcon,
  SparklesIcon,
  ShieldCheckIcon,
} from "lucide-react";

import styles from "./inspiration-citation-card.module.css";

export type InspirationCitation = {
  id: string;
  entryId?: string;
  caseId?: string;
  title: string;
  source: string;
  license: string;
  relevance: string;
  isMock?: boolean;
};

export type CourseReference = {
  id: string;
  title: string;
  detail?: string;
};

type InspirationCitationCardProps = {
  citations?: readonly InspirationCitation[];
  courseReferences?: readonly CourseReference[];
  presentation?: "answer" | "context" | "wiki";
};

export function InspirationCitationCard({
  citations = [],
  courseReferences = [],
  presentation = "answer",
}: InspirationCitationCardProps) {
  if (citations.length === 0) return null;

  const isMock = citations.some((citation) => citation.isMock);
  const heading = presentation === "wiki"
    ? "灵感 Wiki 推荐形态"
    : presentation === "context"
      ? "已选灵感案例"
      : "灵感 Wiki 推荐案例";

  return (
    <section
      aria-label={heading}
      className={styles.card}
      data-presentation={presentation}
    >
      <header className={styles.header}>
        <div>
          <p><SparklesIcon aria-hidden="true" size={14} /> 灵感推荐</p>
          <h3>{heading}</h3>
        </div>
        <span className={styles.count}>{citations.length} 条</span>
      </header>

      <section className={styles.courseReference} aria-label="课程引用">
        <div className={styles.referenceLabel}>
          <BookOpenCheckIcon aria-hidden="true" size={14} />
          <span>课程引用</span>
        </div>
        {courseReferences.length > 0 ? (
          <ul>
            {courseReferences.map((reference) => (
              <li key={reference.id}>
                <strong>{reference.title}</strong>
                {reference.detail ? <span>{reference.detail}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p>当前没有课程引用；灵感案例不会替代课程依据。</p>
        )}
      </section>

      <ol className={styles.citationList}>
        {citations.map((citation) => {
          const detailHref = citation.entryId
            ? `/student?inspiration=1&entry=${encodeURIComponent(citation.entryId)}#inspiration-entry-detail`
            : citation.caseId
              ? `/student?inspiration=1&case=${encodeURIComponent(citation.caseId)}`
              : "/student?inspiration=1";
          const detailLabel = citation.entryId ? "查看详情" : citation.caseId ? "打开受控案例页" : "浏览案例库";
          return <li key={citation.id}>
            <div className={styles.caseHeading}>
          <span>推荐案例</span>
              <Link href={detailHref}>
                {detailLabel} <ExternalLinkIcon aria-hidden="true" size={13} />
              </Link>
            </div>
            <h4>{citation.title}</h4>
            <p className={styles.relevance}><strong>为何相关</strong>{citation.relevance}</p>
            <dl>
              <div><dt>来源</dt><dd>{citation.source}</dd></div>
              <div><dt>许可</dt><dd><ShieldCheckIcon aria-hidden="true" size={13} />{citation.license}</dd></div>
            </dl>
          </li>;
        })}
      </ol>

      {isMock ? (
        <p className={styles.mockNotice} role="status">
          本地合规 mock：仅演示灵感推荐卡信息结构，尚未接入实际检索。
        </p>
      ) : null}
    </section>
  );
}
