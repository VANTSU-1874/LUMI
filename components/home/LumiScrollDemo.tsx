import Image from "next/image";

export function LumiScrollDemo() {
  return (
    <section className="lumi-f35-demo" id="demo" aria-labelledby="demo-title">
      <div className="lumi-f35-shell lumi-f35-demo-intro">
        <header className="lumi-f35-section-heading">
          <p className="lumi-f35-eyebrow">02 / LIVE STORY</p>
          <h2 id="demo-title">
            <span>Every Work Begins as a Wondrous Idea</span>
            <small>作品，萌生于奇妙的想法</small>
          </h2>
        </header>
        <div className="lumi-f35-demo-lead">
          <p>这是一名视觉传达设计专业二年级学生的典型处境：她做了一面以石刻纹样为主题的交互展墙草图，观众靠近时纹样逐步显影。她卡在一个说不清的地方——观众到底知不知道自己该做什么。</p>
          <p>往下滚，看 Lumi 怎么跟她谈这张图。</p>
        </div>
      </div>

      <div className="lumi-f35-demo-stage lumi-f35-demo-interface-target">
        <Image
          src="/media/lumi-demo-interface.png"
          alt="Lumi 对话工作台演示界面"
          fill
          sizes="(max-width: 920px) calc(100vw - 40px), 1260px"
        />
      </div>
    </section>
  );
}
