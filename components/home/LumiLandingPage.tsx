import Link from "next/link";

import { EntryForm } from "@/components/entry/EntryForm";
import { LumiContactDialog } from "@/components/home/LumiContactDialog";
import { LumiCritWall } from "@/components/home/LumiCritWall";
import { LumiHeroF35 } from "@/components/home/LumiHeroF35";
import { LumiPageBackground } from "@/components/home/LumiPageBackground";
import { LumiScrollDemo } from "@/components/home/LumiScrollDemo";

const courses = [
  "版式设计",
  "品牌与 VI 设计",
  "图形创意",
  "IP 形象设计",
  "书籍设计",
  "界面设计",
  "数字交互文创设计",
  "数字图形（Illustrator）",
  "数字图像（Photoshop）",
  "数字影像（Premiere）",
  "Blender 建模",
] as const;

const mentorQualities = [
  {
    eyebrow: "CITED SOURCES",
    title: "一个讲话有出处的老师",
    copy: "它会指着你的版面说话，并告诉你依据来自哪份课程资料——就是你老师上传的那份。",
  },
  {
    eyebrow: "GROWTH PROFILE",
    title: "一个记得你的老师",
    copy: "你擅长什么、卡在哪、上一稿改到哪一步——不用每次重新自我介绍。",
  },
  {
    eyebrow: "WHY & HOW",
    title: "一个能文能武的老师",
    copy: "“构图为什么不舒服”，它陪你讲道理；“画面怎么不动了”，它要截图、逐环排查。",
  },
  {
    eyebrow: "CHARACTER",
    title: "一个不替你做设计的老师",
    copy: "先追问，再提示，最后才示范。自己想明白的方案，评图时是听得出来的。",
  },
] as const;

function SectionHeading({
  chinese,
  english,
  id,
  index,
}: {
  chinese: string;
  english: string;
  id?: string;
  index: string;
}) {
  return (
    <header className="lumi-f35-section-heading">
      <p className="lumi-f35-eyebrow">{index} / LUMI</p>
      <h2 id={id}>
        <span>{english}</span>
        <small>{chinese}</small>
      </h2>
    </header>
  );
}

export function LumiLandingPage() {
  return (
    <div className="lumi-f35">
      <LumiPageBackground />
      <LumiHeroF35 />

      <main>
        <LumiScrollDemo />

        <section className="lumi-f35-feedback" id="courses" aria-labelledby="feedback-title">
          <div className="lumi-f35-shell">
            <SectionHeading
              chinese="设计路上，多一位随时能反馈的老师"
              english="Never Design Alone"
              id="feedback-title"
              index="03"
            />
            <p className="lumi-f35-feedback-copy">
              晚上十一点赶图卡住，不用攒到明天上课再问。从版式的字距，到 Blender 里的一个法线朝向，问的是同一个它——换课不用换工具，也不用重新解释你是谁。
            </p>
            <div className="lumi-f35-course-proof" aria-label="课程覆盖">
              <p>这 11 门课里，它都在。</p>
              <div>
                {courses.map((course) => (
                  <span key={course}>{course}</span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="lumi-f35-mentor" id="mentor" aria-labelledby="mentor-title">
          <div className="lumi-f35-shell">
            <SectionHeading
              chinese="懂这门课，也记得你这个人"
              english="Knows the Craft, Knows You"
              id="mentor-title"
              index="04"
            />
            <div className="lumi-f35-mentor-list">
              {mentorQualities.map((quality, index) => (
                <article key={quality.eyebrow}>
                  <div className="lumi-f35-mentor-index">0{index + 1}</div>
                  <p className="lumi-f35-eyebrow">{quality.eyebrow}</p>
                  <h3>{quality.title}</h3>
                  <p>{quality.copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="lumi-f35-sides" id="classroom" aria-labelledby="classroom-title">
          <div className="lumi-f35-shell">
            <SectionHeading
              chinese="学生这样用，老师这样用"
              english="Two Sides, One Classroom"
              id="classroom-title"
              index="05"
            />
            <div className="lumi-f35-sides-grid">
              <article>
                <p className="lumi-f35-eyebrow">FOR STUDENTS / 学生</p>
                <ol>
                  <li>扫码进入，匿名编号。</li>
                  <li>传作品，听会诊，改下一稿。</li>
                  <li>成长档案跟着你，只有你和老师看得见。</li>
                </ol>
              </article>
              <article>
                <p className="lumi-f35-eyebrow">FOR TEACHERS / 教师</p>
                <ol>
                  <li>传一份课程资料，它就照着你的课讲。</li>
                  <li>不看聊天字数，只看可行动的事。</li>
                </ol>
              </article>
            </div>
          </div>
        </section>

        <LumiCritWall />

        <section className="lumi-f35-final" id="start" aria-labelledby="final-title">
          <div className="lumi-f35-final-inner">
            <SectionHeading
              chinese="下一稿，让它先看一遍"
              english="Bring Your Next Draft"
              id="final-title"
              index="07"
            />
            <div className="lumi-f35-final-actions">
              <Link className="lumi-f35-command lumi-f35-command-primary" href="/student?demo=1">
                <span>进入工作台</span>
                <span aria-hidden="true">↗</span>
              </Link>
              <LumiContactDialog className="lumi-f35-command lumi-f35-command-secondary" />
            </div>
            <div className="lumi-entry lumi-f35-entry">
              <div className="lumi-entry-heading">
                <span>身份入口</span>
                <p>STUDENT / TEACHER</p>
              </div>
              <EntryForm />
            </div>
          </div>
        </section>
      </main>

      <footer className="lumi-f35-footer">
        <div>
          <strong>Lumi 鹿鸣</strong>
          <nav aria-label="页脚导航">
            <LumiContactDialog compact />
            <Link href="/privacy">隐私说明</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
