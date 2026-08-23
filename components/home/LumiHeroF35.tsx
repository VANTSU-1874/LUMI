"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import PillNav from "@/components/PillNav";
import StaggeredMenu from "@/components/StaggeredMenu";
import TextType from "@/components/TextType";
import { LumiHeroLaptop } from "@/components/home/LumiHeroLaptop";

const MENU_ITEMS = [
  { label: "Home", ariaLabel: "返回首页首屏", link: "#top" },
  { label: "Demo", ariaLabel: "查看导师演示", link: "#demo" },
  { label: "Courses", ariaLabel: "查看课程覆盖", link: "#courses" },
  { label: "Mentor", ariaLabel: "了解 Lumi 导师", link: "#mentor" },
  { label: "Start", ariaLabel: "前往开始使用", link: "#start" },
  { label: "Login", ariaLabel: "进入 Lumi 登录", link: "/login" },
  { label: "Privacy", ariaLabel: "查看隐私说明", link: "/privacy" },
];

function LumiHeroTitle() {
  const [shouldAnimate, setShouldAnimate] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = () => setShouldAnimate(!mediaQuery.matches);

    updateMotionPreference();
    mediaQuery.addEventListener("change", updateMotionPreference);
    return () => mediaQuery.removeEventListener("change", updateMotionPreference);
  }, []);

  return (
    <h1 aria-label="我们今天做什么" className="lumi-f35-hero-title">
      {shouldAnimate ? (
        <TextType
          text={[
            "我们今天做什么",
            "LUMI",
            "视觉传达设计教学智能体",
            "覆盖 11 门专业核心课程",
            "从初学到提升",
          ]}
          typingSpeed={75}
          pauseDuration={1500}
          deletingSpeed={50}
          betweenTextDelay={450}
          showCursor
          cursorCharacter="●"
          cursorBlinkDuration={0.5}
          startOnVisible
          className="lumi-f35-hero-title-text"
          cursorClassName="lumi-f35-hero-title-cursor"
        />
      ) : (
        <span className="lumi-f35-hero-title-text">我们今天做什么</span>
      )}
    </h1>
  );
}

export function LumiHeroF35() {
  return (
    <header className="lumi-f35-hero" id="top">
      <StaggeredMenu
        position="left"
        items={MENU_ITEMS}
        socialItems={[]}
        displaySocials={false}
        displayItemNumbering
        menuButtonColor="#26201a"
        openMenuButtonColor="#26201a"
        changeMenuColorOnOpen
        colors={["#fbc4a3", "#becf97"]}
        logoUrl="/favicon.ico"
        accentColor="#9fbb3e"
        className="lumi-f35-staggered-menu"
      />

      <PillNav
        items={[
          { label: "演示", href: "#demo" },
          { label: "课程", href: "#courses" },
        ]}
        className="lumi-f35-pill-nav"
        ease="power2.inOut"
        baseColor="rgb(255 255 255 / 46%)"
        pillColor="#ffffff"
        hoverPillColor="#000000"
        hoveredPillTextColor="#ffffff"
        pillTextColor="#000000"
        theme="light"
        initialLoadAnimation={false}
      />

      <div className="lumi-f35-hero-bar">
        <a className="lumi-f35-wordmark" href="#top" aria-label="Lumi 鹿鸣首页">
          <strong>LUMI</strong>
        </a>
        <Link aria-label="登录 Lumi" className="lumi-f35-login-entry" href="/login">
          <span>登录 Lumi</span>
          <span aria-hidden="true">↗</span>
        </Link>
      </div>

      <div className="lumi-f35-hero-poster">
        <p className="lumi-f35-satellite lumi-f35-satellite-left">
          自建多模态检索增强<br />视觉传达设计教学智能体
        </p>
        <p className="lumi-f35-satellite lumi-f35-satellite-right">
          覆盖 11 门专业核心课程<br />从初学到提升
        </p>

        <LumiHeroTitle />

        <p className="lumi-f35-mobile-subtitle">
          自建多模态检索增强 · 视觉传达设计教学智能体
        </p>

        <LumiHeroLaptop />

        <div className="lumi-f35-preview-stack" aria-label="首页预览">
          <a className="lumi-f35-preview-card lumi-f35-preview-left" href="#demo">
            <span>01 / DEMO</span>
            <strong>会诊</strong>
            <i aria-hidden="true"><b /><b /><b /></i>
          </a>
          <a className="lumi-f35-preview-card lumi-f35-preview-right" href="#courses">
            <span>02 / COURSES</span>
            <strong>课程</strong>
            <i aria-hidden="true"><b>版式</b><b>品牌</b><b>交互</b></i>
          </a>
        </div>

        <aside className="lumi-f35-hero-cta" aria-label="开始使用">
          <p>开始使用</p>
          <Link href="/student?demo=1">
            <strong>以演示学生身份进入</strong>
            <span aria-hidden="true">↗</span>
          </Link>
          <details>
            <summary>创建或登录账号</summary>
            <p>学生可创建账号；教师账号由课程管理员预置。</p>
            <Link href="/login?mode=register">创建学生账号</Link>
          </details>
        </aside>
      </div>

      <p className="lumi-f35-hero-footnote">
        本站演示内容均为预置剧本，用于展示产品结构，不代表真实学生数据。
      </p>
    </header>
  );
}
