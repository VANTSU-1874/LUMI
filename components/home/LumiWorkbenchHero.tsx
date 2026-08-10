"use client";

import Magnet from "@/components/ui/Magnet";

const ACTIVE_TRANSITION = "transform 140ms cubic-bezier(.2,.8,.2,1)";
const INACTIVE_TRANSITION = "transform 360ms cubic-bezier(.22,1,.36,1)";

function DrawingPen() {
  return (
    <svg aria-hidden="true" viewBox="0 0 720 128">
      <defs>
        <linearGradient id="lumi-pen-body" x1="0" x2="1">
          <stop offset="0" stopColor="#e5c08e" />
          <stop offset="0.52" stopColor="#fff0cb" />
          <stop offset="1" stopColor="#c58b55" />
        </linearGradient>
        <filter id="lumi-pen-shadow" x="-20%" y="-80%" width="150%" height="260%">
          <feDropShadow dx="9" dy="13" floodColor="#1b1209" floodOpacity=".36" stdDeviation="9" />
        </filter>
      </defs>
      <g filter="url(#lumi-pen-shadow)">
        <path d="M40 42h554c23 0 41 11 41 25s-18 25-41 25H40c-16 0-28-11-28-25s12-25 28-25Z" fill="url(#lumi-pen-body)" />
        <path d="M593 42h42l71 25-71 25h-42c11-8 17-16 17-25s-6-17-17-25Z" fill="#f0d3a2" />
        <path d="m706 67-31-11v22Z" fill="#2c231c" />
        <path d="M48 50h492" stroke="#fff8e7" strokeLinecap="round" strokeOpacity=".58" strokeWidth="7" />
        <path d="M94 45v45" stroke="#9b633d" strokeOpacity=".46" strokeWidth="3" />
      </g>
    </svg>
  );
}

function UtilityKnife() {
  return (
    <svg aria-hidden="true" viewBox="0 0 690 190">
      <defs>
        <linearGradient id="lumi-knife-shell" x1="0" x2="1" y1="0" y2="1">
          <stop stopColor="#f3a23d" />
          <stop offset=".52" stopColor="#df682f" />
          <stop offset="1" stopColor="#9f321f" />
        </linearGradient>
        <linearGradient id="lumi-blade" x1="0" x2="1">
          <stop stopColor="#f7f2e7" />
          <stop offset=".5" stopColor="#a8aaa5" />
          <stop offset="1" stopColor="#e9e3d9" />
        </linearGradient>
        <filter id="lumi-knife-shadow" x="-15%" y="-60%" width="150%" height="240%">
          <feDropShadow dx="10" dy="16" floodColor="#28140a" floodOpacity=".42" stdDeviation="10" />
        </filter>
      </defs>
      <g filter="url(#lumi-knife-shadow)">
        <path d="m8 82 146-37 26 86L16 113Z" fill="url(#lumi-blade)" />
        <path d="m36 75 9 38M75 65l10 39m29-49 11 40" stroke="#6e706d" strokeOpacity=".45" strokeWidth="3" />
        <path d="M154 36h458c39 0 68 25 68 57s-29 57-68 57H154c-26 0-44-23-44-57s18-57 44-57Z" fill="url(#lumi-knife-shell)" />
        <path d="M214 54h342c29 0 48 15 48 39s-19 39-48 39H214c-21 0-37-17-37-39s16-39 37-39Z" fill="#40291f" fillOpacity=".84" />
        <path d="M239 68h280c22 0 36 10 36 25s-14 25-36 25H239c-16 0-28-11-28-25s12-25 28-25Z" fill="#c3b4a1" />
        <path d="M267 74h218" stroke="#eee6d6" strokeLinecap="round" strokeOpacity=".48" strokeWidth="7" />
        <rect width="65" height="64" x="498" y="61" rx="15" fill="#e17631" />
        <rect width="34" height="42" x="514" y="72" rx="10" fill="#432d22" />
        <path d="M637 51c23 9 35 24 35 42s-12 34-35 44Z" fill="#62291f" fillOpacity=".72" />
      </g>
    </svg>
  );
}

function Camera() {
  return (
    <svg aria-hidden="true" viewBox="0 0 440 330">
      <defs>
        <radialGradient id="lumi-camera-lens">
          <stop stopColor="#8fb6b0" />
          <stop offset=".22" stopColor="#314b4e" />
          <stop offset=".56" stopColor="#101b1d" />
          <stop offset="1" stopColor="#030606" />
        </radialGradient>
        <linearGradient id="lumi-camera-body" x1="0" x2="1" y1="0" y2="1">
          <stop stopColor="#393833" />
          <stop offset=".5" stopColor="#151715" />
          <stop offset="1" stopColor="#050706" />
        </linearGradient>
        <filter id="lumi-camera-shadow" x="-30%" y="-35%" width="180%" height="200%">
          <feDropShadow dx="13" dy="20" floodColor="#1c1109" floodOpacity=".48" stdDeviation="13" />
        </filter>
      </defs>
      <g filter="url(#lumi-camera-shadow)">
        <path d="M78 70h93l24-38h98l28 38h49c29 0 52 23 52 52v139c0 29-23 52-52 52H78c-29 0-52-23-52-52V122c0-29 23-52 52-52Z" fill="url(#lumi-camera-body)" />
        <path d="M51 118h346" stroke="#66655d" strokeOpacity=".46" strokeWidth="4" />
        <rect width="62" height="24" x="92" y="39" rx="8" fill="#22231f" />
        <rect width="37" height="24" x="334" y="84" rx="9" fill="#a2542f" />
        <circle cx="231" cy="190" r="102" fill="#080b0a" stroke="#5c5f59" strokeWidth="7" />
        <circle cx="231" cy="190" r="79" fill="url(#lumi-camera-lens)" stroke="#242a29" strokeWidth="10" />
        <circle cx="209" cy="164" r="24" fill="#e2f1db" fillOpacity=".18" />
        <path d="M177 143c24-27 67-36 103-17" fill="none" stroke="#e2f1db" strokeLinecap="round" strokeOpacity=".28" strokeWidth="8" />
        <path d="M61 95h92" stroke="#a8a095" strokeLinecap="round" strokeOpacity=".3" strokeWidth="6" />
        <text x="78" y="284" fill="#d4cec1" fontFamily="Arial, sans-serif" fontSize="18" fontWeight="700" letterSpacing="5">LUMI</text>
      </g>
    </svg>
  );
}

export function LumiWorkbenchHero() {
  return (
    <section className="lumi-workbench-hero" aria-labelledby="lumi-hero-title">
      <div className="lumi-workbench-mat" aria-hidden="true">
        <span className="lumi-mat-axis lumi-mat-axis-x" />
        <span className="lumi-mat-axis lumi-mat-axis-y" />
      </div>

      <div className="lumi-workbench-heading">
        <p>DESIGN LEARNING COMPANION</p>
        <h1 id="lumi-hero-title">LUMI</h1>
        <span>鹿鸣 · 视觉传达设计专业 AI 成长导师</span>
      </div>

      <div className="lumi-workbench-statement">
        <span>01 / LEARN WITH EVIDENCE</span>
        <p>把“哪里不对”变成可观察、可修改的学习动作。</p>
      </div>

      <aside className="lumi-workbench-note">
        <strong>看懂作品，<br />也看见学生。</strong>
        <span />
        <p>Lumi 先问清目标，再给专业依据，最后只收束到最值得改的一步。</p>
        <a href="#experience">看会诊演示 <b aria-hidden="true">↗</b></a>
      </aside>

      <Magnet
        aria-hidden="true"
        activeTransition={ACTIVE_TRANSITION}
        inactiveTransition={INACTIVE_TRANSITION}
        innerClassName="lumi-workbench-tool-inner"
        magnetStrength={12}
        maxOffset={8}
        padding={44}
        style={{ position: "absolute" }}
        wrapperClassName="lumi-workbench-tool lumi-workbench-pen"
      >
        <span className="lumi-tool-visual"><DrawingPen /></span>
      </Magnet>

      <Magnet
        aria-hidden="true"
        activeTransition={ACTIVE_TRANSITION}
        inactiveTransition={INACTIVE_TRANSITION}
        innerClassName="lumi-workbench-tool-inner"
        magnetStrength={14}
        maxOffset={10}
        padding={48}
        style={{ position: "absolute" }}
        wrapperClassName="lumi-workbench-tool lumi-workbench-knife"
      >
        <span className="lumi-tool-visual"><UtilityKnife /></span>
      </Magnet>

      <Magnet
        aria-hidden="true"
        activeTransition={ACTIVE_TRANSITION}
        inactiveTransition={INACTIVE_TRANSITION}
        innerClassName="lumi-workbench-tool-inner"
        magnetStrength={16}
        maxOffset={10}
        padding={64}
        style={{ position: "absolute" }}
        wrapperClassName="lumi-workbench-tool lumi-workbench-camera"
      >
        <span className="lumi-tool-visual"><Camera /></span>
      </Magnet>

      <a className="lumi-workbench-scroll" href="#disciplines">
        <span aria-hidden="true">↓</span> 向下了解 Lumi
      </a>
    </section>
  );
}
