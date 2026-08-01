import type { StudentDashboard } from "@/lib/domain/student-dashboard";

const dimensions = [
  ["decomposition", "任务拆解"], ["signalUnderstanding", "信号理解"], ["mappingDesign", "映射设计"],
  ["troubleshooting", "排障定位"], ["transfer", "迁移应用"],
] as const;

export function ProfileCard({
  displayName,
  profile,
}: {
  displayName?: string;
  profile: StudentDashboard["profile"];
}) {
  return <section aria-labelledby="profile-title" className="rounded-[1.5rem] border border-[#dce4df] bg-[#fffef9] p-5">
    <p className="text-[10px] font-black tracking-[0.18em] text-[#178b73]">PERSONAL PROFILE</p><h2 id="profile-title" className="mt-1 text-xl font-black text-[#17332d]">{displayName ? `${displayName}的学习画像` : "学习画像"}</h2>
    {!profile ? <div className="mt-4 rounded-xl bg-[#edf5f0] p-4"><p className="font-black text-[#3f5f56]">等待诊断</p><p className="mt-1 text-sm leading-6 text-[#71847f]">完成情境题后，生成五维画像并调整后续支持。</p></div> : <>
      <p className="mt-3 inline-flex rounded-full bg-[#e2f4ed] px-3 py-1 text-sm font-black text-[#0d6858]">{profile.level} 学习支持级别</p>
      <dl className="mt-4 grid grid-cols-2 gap-2">
        {dimensions.map(([key, label]) => <div className="rounded-xl bg-[#f1f5f2] p-3" key={key}><dt className="text-xs text-[#71847f]">{label}</dt><dd className="mt-1 font-black text-[#17332d]">{profile[key]}/4</dd><div aria-hidden="true" className="mt-2 h-1.5 rounded-full bg-[#dce4df]"><div className="h-full rounded-full bg-[#178b73]" style={{ width: `${(profile[key] / 4) * 100}%` }} /></div></div>)}
      </dl>
      <p className="mt-3 text-xs text-[#71847f]">画像只用于调整学习支持，不作同伴排名。</p>
    </>}
  </section>;
}
