import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import { digestIdentityCode } from "@/lib/auth/identity-code";
import {
  getLumiAuthRuntime,
  LUMI_INTERNAL_REGISTRATION_HEADER,
} from "@/lib/auth/better-auth";
import { grantTeacherAccessScope } from "@/lib/auth/teacher-access";
import { appendStudentAgentMessage } from "@/lib/agent/agent-message-store";
import { createDesignTask } from "@/lib/agent/design-project-task";
import { currentAgentRuntime } from "@/lib/agent/runtime/current-agent-runtime";
import { claimAgentRun } from "@/lib/agent/runtime/agent-run-lifecycle";
import { createAgentRun } from "@/lib/agent/runtime/run-state-store";
import { createDb } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";
import { ingestCoursePackKnowledge } from "@/lib/knowledge/course-pack-store";
import { seedDemoDatabase } from "@/scripts/seed-demo";

const DATABASE_PATH = process.env.DATABASE_PATH ?? ".runtime/e2e-demo-student-flow.sqlite";
const PEPPER = process.env.IDENTITY_CODE_PEPPER ?? "e2e-identity-pepper-at-least-32-characters-long";
const E2E_TEACHER_EMAIL = "teacher.e2e@example.com";
const E2E_TEACHER_PASSWORD = "LumiTeacher2026!";
export const E2E_IDENTITY_CODES = [
  "AB7K-C9M2-Q4RP", "CD8L-N3R5-TQ9W", "EF9M-P4S6-VR2X", "GH2N-Q5T7-WX3Z", "JK4P-R6V8-YZ5B",
  "LM3T-R7V9-X2QA", "NP4U-S8W2-Y3RB", "QR5V-T9X3-Z4SC",
  "ST6W-U4Y8-A7KD",
] as const;

async function main() {
  const absolute = path.resolve(DATABASE_PATH);
  const runtimeRoot = path.resolve(".runtime");
  const artworkRoot = path.resolve(process.env.EVIDENCE_ROOT ?? ".runtime/e2e-evidence");
  if (!absolute.startsWith(`${runtimeRoot}${path.sep}`)) throw new Error("E2E数据库必须位于工作树.runtime目录");
  if (!artworkRoot.startsWith(`${runtimeRoot}${path.sep}`)) throw new Error("E2E作品目录必须位于工作树.runtime目录");
  await mkdir(path.dirname(absolute), { recursive: true });
  await rm(absolute, { force: true });
  await rm(`${absolute}-wal`, { force: true });
  await rm(`${absolute}-shm`, { force: true });
  await rm(artworkRoot, { recursive: true, force: true });
  runMigrations(absolute);
  const connection = createDb(absolute);
  try {
    const now = Math.floor(Date.now() / 1_000);
    const digests = E2E_IDENTITY_CODES.map((code) => digestIdentityCode(code, PEPPER));
    connection.sqlite.exec(`
      INSERT INTO classes(id,name,access_code) VALUES('e2e-class','数字交互文创设计','E2E2026');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES
        ('e2e-student-1','e2e-class','STUDENT','匿名编号 01',${now}),('e2e-student-2','e2e-class','STUDENT','匿名编号 02',${now}),('e2e-student-3','e2e-class','STUDENT','匿名编号 03',${now}),
        ('e2e-student-4','e2e-class','STUDENT','无障碍制作测试',${now}),('e2e-student-5','e2e-class','STUDENT','无障碍诊断测试',${now}),
        ('e2e-student-6','e2e-class','STUDENT','DigiShow传输测试',${now}),('e2e-student-7','e2e-class','STUDENT','TouchDesigner传输测试',${now}),
        ('e2e-student-8','e2e-class','STUDENT','协同传输测试',${now}),
        ('e2e-student-9','e2e-class','STUDENT','运行中补充测试',${now});
      UPDATE users SET onboarding_completed_at=${now}
        WHERE class_id='e2e-class' AND role='STUDENT';
      INSERT INTO student_identity_codes(code_digest,class_id,claimed_user_id,created_at,claimed_at) VALUES
        ('${digests[0]}','e2e-class','e2e-student-1',${now},${now}),('${digests[1]}','e2e-class','e2e-student-2',${now},${now}),('${digests[2]}','e2e-class','e2e-student-3',${now},${now}),
        ('${digests[3]}','e2e-class','e2e-student-4',${now},${now}),('${digests[4]}','e2e-class','e2e-student-5',${now},${now}),
        ('${digests[5]}','e2e-class','e2e-student-6',${now},${now}),('${digests[6]}','e2e-class','e2e-student-7',${now},${now}),
        ('${digests[7]}','e2e-class','e2e-student-8',${now},${now}),
        ('${digests[8]}','e2e-class','e2e-student-9',${now},${now});
      INSERT INTO learner_profiles(user_id,level,decomposition,signal_understanding,mapping_design,troubleshooting,transfer,updated_at) VALUES
        ('e2e-student-1','L2',2,2,2,2,2,${now}),('e2e-student-2','L2',2,2,2,2,2,${now}),('e2e-student-3','L2',2,2,2,2,2,${now}),
        ('e2e-student-4','L2',2,2,2,2,2,${now}),('e2e-student-6','L2',2,2,2,2,2,${now}),
        ('e2e-student-7','L2',2,2,2,2,2,${now}),('e2e-student-8','L2',2,2,2,2,2,${now}),
        ('e2e-student-9','L2',2,2,2,2,2,${now});
      INSERT INTO course_modules(id,class_id,sequence,title,hours,focus) VALUES
        ('e2e-m1','e2e-class',1,'感知与诊断',8,'识别输入、输出与文化意图'),
        ('e2e-m2','e2e-class',2,'六元交互逻辑',16,'建立可验证的交互因果链'),
        ('e2e-m3','e2e-class',3,'工具与原型',24,'DigiShow与TouchDesigner分层制作'),
        ('e2e-m4','e2e-class',4,'证据、排障与迁移',16,'用证据排查并迁移结构');
      INSERT INTO assignments(id,class_id,module_id,title,brief,allowed_tools,created_at)
        VALUES('e2e-a1','e2e-class','e2e-m2','社区灯影互动','把社区文化意图转化为可验证的数字交互原型','["DIGISHOW","TOUCHDESIGNER","COLLABORATIVE"]',${now});
      INSERT INTO projects(id,class_id,assignment_id,student_id,stage,created_at,updated_at) VALUES
        ('e2e-p1','e2e-class','e2e-a1','e2e-student-1','LOGIC_CARD',${now},${now}),
        ('e2e-p2','e2e-class','e2e-a1','e2e-student-2','LOGIC_CARD',${now},${now}),
        ('e2e-p3','e2e-class','e2e-a1','e2e-student-3','LOGIC_CARD',${now},${now}),
        ('e2e-p4','e2e-class','e2e-a1','e2e-student-4','BUILD',${now},${now}),
        ('e2e-p5','e2e-class','e2e-a1','e2e-student-5','DIAGNOSTIC',${now},${now}),
        ('e2e-p6','e2e-class','e2e-a1','e2e-student-6','BUILD',${now},${now}),
        ('e2e-p7','e2e-class','e2e-a1','e2e-student-7','BUILD',${now},${now}),
        ('e2e-p8','e2e-class','e2e-a1','e2e-student-8','BUILD',${now},${now});
      INSERT INTO tool_path_plans(project_id,path,requirements_json,reasons_json,milestones_json,created_at,updated_at) VALUES
        ('e2e-p6','DIGISHOW','{"needsRealtimeVisuals":false,"needsPhysicalControl":true,"hasOsc":false}','["单独使用DigiShow完成交互"]','[{"id":"m1","title":"输入","requiredEvidenceLabel":"输入"},{"id":"m2","title":"映射","requiredEvidenceLabel":"映射"},{"id":"m3","title":"输出","requiredEvidenceLabel":"输出"}]',${now},${now}),
        ('e2e-p7','TOUCHDESIGNER','{"needsRealtimeVisuals":true,"needsPhysicalControl":false,"hasOsc":false}','["单独使用TouchDesigner完成实时视觉"]','[{"id":"m1","title":"输入","requiredEvidenceLabel":"输入"},{"id":"m2","title":"映射","requiredEvidenceLabel":"映射"},{"id":"m3","title":"输出","requiredEvidenceLabel":"输出"}]',${now},${now}),
        ('e2e-p8','COLLABORATIVE','{"needsRealtimeVisuals":true,"needsPhysicalControl":true,"hasOsc":true}','["使用OSC连接两个工具"]','[{"id":"m1","title":"输入","requiredEvidenceLabel":"输入"},{"id":"m2","title":"传输","requiredEvidenceLabel":"OSC"},{"id":"m3","title":"输出","requiredEvidenceLabel":"输出"}]',${now},${now});
      INSERT INTO classes(id,name,access_code) VALUES('e2e-teacher-class','教师分析独立班','TEACHER-CLASS-PRIVATE');
      INSERT INTO users(id,class_id,role,alias,created_at) VALUES
        ('e2e-teacher-student-1','e2e-teacher-class','STUDENT','匿名-教师01',${now}),
        ('e2e-teacher-student-2','e2e-teacher-class','STUDENT','匿名-教师02',${now});
      INSERT INTO learner_profiles(user_id,level,decomposition,signal_understanding,mapping_design,troubleshooting,transfer,updated_at) VALUES
        ('e2e-teacher-student-1','L1',1,2,1,2,2,${now}),
        ('e2e-teacher-student-2','L3',3,3,3,3,3,${now});
      INSERT INTO course_modules(id,class_id,sequence,title,hours,focus) VALUES
        ('e2e-teacher-m1','e2e-teacher-class',1,'六元交互逻辑',16,'建立可验证的交互因果链');
      INSERT INTO assignments(id,class_id,module_id,title,brief,allowed_tools,created_at) VALUES
        ('e2e-teacher-a1','e2e-teacher-class','e2e-teacher-m1','社区灯影互动','教师分析独立测试任务','["DIGISHOW","TOUCHDESIGNER"]',${now});
      INSERT INTO projects(id,class_id,assignment_id,student_id,stage,created_at,updated_at) VALUES
        ('e2e-teacher-p1','e2e-teacher-class','e2e-teacher-a1','e2e-teacher-student-1','LOGIC_CARD',${now},${now}),
        ('e2e-teacher-p2','e2e-teacher-class','e2e-teacher-a1','e2e-teacher-student-2','TRANSFER',${now},${now});
      INSERT INTO logic_cards(project_id,payload_json,rule_ready,semantic_ready,semantic_review_json,revision,card_hash) VALUES
        ('e2e-teacher-p1','{"audience":"社区居民","context":"社区广场","input":"距离","mapping":"越近越亮","output":"灯影","culturalIntent":"共创"}',1,0,'{"status":"NEEDS_REVISION","ready":false,"issues":["MAPPING_WEAK"],"source":"RULE"}',1,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      INSERT INTO evidence(id,project_id,class_id,student_id,evidence_sequence,kind,signal_layer,confirmed_code,verification_status,storage_status,label,content,content_digest,probe_json,original_name,created_at) VALUES
        ('33333333-3333-4333-8333-333333333333','e2e-teacher-p1','e2e-teacher-class','e2e-teacher-student-1',1,'TEXT','INPUT',NULL,'SUBMITTED','READY','教师同步证据','输入值有变化','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',NULL,NULL,${now});
      INSERT INTO design_project_tasks(id,student_id,class_id,title,status,created_at,updated_at,data_type) VALUES
        ('77777777-7777-4777-8777-777777777777','e2e-teacher-student-1','e2e-teacher-class','声音画面排障','ACTIVE',${now},${now},'REAL');
      INSERT INTO agent_conversations(id,task_id,student_id,class_id,project_id,course_pack_id,course_pack_version,created_at,updated_at) VALUES
        ('88888888-8888-4888-8888-888888888888','77777777-7777-4777-8777-777777777777','e2e-teacher-student-1','e2e-teacher-class','e2e-teacher-p1','digital-interaction','1',${now},${now});
      INSERT INTO agent_turns(id,conversation_id,turn_sequence,student_message,episode,decision_code,policy_trace_json,response_strategy,response_latency_ms,reply_json,ai_mode,source_ids_json,created_at,data_type) VALUES
        ('99999999-9999-4999-8999-999999999999','88888888-8888-4888-8888-888888888888',1,'声音有数值但画面不动','DEBUG','DEBUG_TRACE_SIGNAL','{"policyId":"competition-core","policyVersion":"1","budgets":{"modelDecisions":2,"maxModelDecisions":4,"toolCalls":1,"maxToolCalls":6,"turnTimeoutMs":30000},"autonomy":{"readOnlyTools":"AUTOMATIC","studentMutations":"STUDENT_CONFIRMATION","formalAuthority":"FORBIDDEN"},"appliedRules":["BOUND_EXECUTION","REGISTERED_TOOLS_ONLY","READ_ONLY_TOOLS_AUTOMATIC","PERSIST_EXECUTION_TRACE","GROUND_TOOL_OBSERVATIONS"]}','DIAGNOSTIC_GUIDANCE',48,'{"eyebrow":"排障导师","title":"先核对输出链","message":"当前项目有一条输入证据，但还没有经过验证的输出证据。","whyThisStep":"先读取真实学习现场，才能避免凭空猜测节点故障。","uncertainty":"尚未看到输出节点状态和画面截图。","graph":{"nodes":[{"id":"evidence","label":"现有证据","kind":"EVIDENCE"},{"id":"action","label":"核对输出","kind":"ACTION"}],"links":[["evidence","action"]]},"sources":[{"id":"tool:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","title":"当前项目与五层证据","authority":"LEARNING_RECORD","scope":"本回合只读观察"}],"actions":[{"id":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","type":"START_TROUBLESHOOTING","label":"开始证据排障","description":"沿输入到输出逐层确认可观察证据。","target":"PROJECT","focus":"troubleshoot","status":"PROPOSED"}]}','MODEL_ASSISTED','["tool:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]',${now},'REAL');
      INSERT INTO agent_tool_calls(id,turn_id,call_sequence,tool_id,tool_version,adapter_id,input_json,output_json,status,error_code,latency_ms,created_at,data_type) VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','99999999-9999-4999-8999-999999999999',1,'project-evidence.read-state','1','project-evidence','{}','{"projectStage":"LOGIC_CARD","evidenceCount":1}','SUCCESS',NULL,12,${now},'REAL');
      INSERT INTO agent_steps(id,turn_id,step_sequence,kind,status,label,summary,tool_call_id,tool_id,latency_ms,created_at,data_type) VALUES
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1','99999999-9999-4999-8999-999999999999',1,'MODEL_DECISION','SUCCEEDED','决定读取学习现场','模型请求只读工具读取当前项目与证据。',NULL,'project-evidence.read-state',11,${now},'REAL'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2','99999999-9999-4999-8999-999999999999',2,'TOOL_CALL','SUCCEEDED','执行只读工具','已调用项目证据工具，未修改学生项目或评价状态。','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','project-evidence.read-state',12,${now},'REAL'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3','99999999-9999-4999-8999-999999999999',3,'TOOL_OBSERVATION','SUCCEEDED','获得可核对观察','项目处于 LOGIC_CARD，已有 1 条证据。','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','project-evidence.read-state',12,${now},'REAL'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4','99999999-9999-4999-8999-999999999999',4,'MODEL_DECISION','SUCCEEDED','形成学习建议','模型选择 DEBUG 情境，并由服务端完成规则校验。',NULL,NULL,13,${now},'REAL'),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5','99999999-9999-4999-8999-999999999999',5,'FINAL_RESPONSE','SUCCEEDED','生成受控回答','回答已绑定课程依据和学生确认行动卡。',NULL,NULL,0,${now},'REAL');
      INSERT INTO agent_actions(id,turn_id,action_sequence,type,label,adapter_id,target,focus,payload_json,status,created_at,data_type) VALUES
        ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','99999999-9999-4999-8999-999999999999',1,'START_TROUBLESHOOTING','开始证据排障','project-evidence','PROJECT','troubleshoot','{}','PROPOSED',${now},'REAL');
      INSERT INTO inspiration_wiki_hermes_batches(
        batch_id,contract_version,package_digest,manifest_json,done_json,candidate_count,
        failure_count,intake_state,student_visible,current_page,r2,embedding,lumi_retrieval,imported_at
      ) VALUES(
        'hermes-e2e-private-001','LEGACY_V1','dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        '{}','{}',1,0,'VALIDATED_PRIVATE',0,'DISABLED','DISABLED','DISABLED','DISABLED',${now}
      );
      INSERT INTO inspiration_wiki_hermes_candidates(
        id,batch_id,source_candidate_id,revision,contract_state,review_state,source_id,
        source_platform,page_url,canonical_url,title,description,author_json,license_json,
        media_json,design_categories_json,screening_json,raw_candidate_json,raw_digest,
        dedupe_fingerprint,scope,student_visible,wiki_draft,current_page,r2,embedding,
        lumi_retrieval,created_at,updated_at
      ) VALUES(
        'hermes-candidate:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee','hermes-e2e-private-001',
        'hc-e2e-private-candidate-001',1,'V1_UPGRADE_REQUIRED','PENDING_REVIEW','e2e-public-source',
        'OTHER_PUBLIC_WEB','https://example.com/e2e-private-work','https://example.com/e2e-private-work',
        'Private E2E candidate',NULL,NULL,NULL,'[{"kind":"IMAGE","asset":null}]',
        '["PRINT","TYPOGRAPHY"]','{"totalScore":24,"evidence":["Public source metadata supports a traceable print design project."]}',
        '{}','eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        'PRIVATE_CANDIDATE',0,'NOT_CREATED','DISABLED','DISABLED','DISABLED','DISABLED',${now},${now}
      );
    `);
    const interventionActor = {
      userId: "e2e-student-9",
      role: "STUDENT" as const,
    };
    const interventionTask = createDesignTask(
      connection,
      interventionActor,
      { title: "运行中的海报方案" },
    );
    const sourceMessageId = "e2e-intervention-source";
    appendStudentAgentMessage({
      connection,
      actor: interventionActor,
      taskId: interventionTask.id,
      message: {
        id: sourceMessageId,
        content: "先分析这张活动海报的视觉方向",
      },
    });
    const sourceRun = createAgentRun({
      connection,
      actor: interventionActor,
      request: {
        taskId: interventionTask.id,
        clientMessageId: sourceMessageId,
        message: "先分析这张活动海报的视觉方向",
        context: { view: "AGENT" },
      },
      idempotencyKey: "e2e-intervention-source-run",
      runtime: currentAgentRuntime.descriptor,
    }).run;
    claimAgentRun({
      connection,
      runId: sourceRun.id,
      workerId: "e2e-held-worker",
    });
    await ingestCoursePackKnowledge(connection);
  } finally { connection.sqlite.close(); }
  await seedDemoDatabase({
    databasePath: absolute,
    artworkRoot,
    identityCodePepper: PEPPER,
    allowDemoSeed: true,
    nodeEnv: "test",
  });

  const publicAppUrl = process.env.PUBLIC_APP_URL ?? "http://127.0.0.1:3000";
  const authRuntime = getLumiAuthRuntime();
  const teacherRegistration = await authRuntime.auth.handler(new Request(
    new URL("/api/auth/sign-up/email", publicAppUrl),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [LUMI_INTERNAL_REGISTRATION_HEADER]: authRuntime.registrationToken,
      },
      body: JSON.stringify({
        name: "E2E 课程负责人",
        email: E2E_TEACHER_EMAIL,
        password: E2E_TEACHER_PASSWORD,
        role: "TEACHER",
        alias: "pending",
        rememberMe: true,
      }),
    },
  ));
  if (!teacherRegistration.ok) {
    throw new Error(`E2E 教师账号创建失败：${teacherRegistration.status} ${await teacherRegistration.text()}`);
  }
  const teacher = authRuntime.connection.sqlite.prepare(
    "SELECT id FROM users WHERE role='TEACHER' AND id IN (SELECT id FROM auth_user WHERE email=?)",
  ).get(E2E_TEACHER_EMAIL) as { id: string } | undefined;
  if (!teacher) throw new Error("E2E 教师课程身份不存在");
  grantTeacherAccessScope(authRuntime.connection.db, {
    teacherId: teacher.id,
    scope: { kind: "GLOBAL" },
    grantedBy: "E2E_SEED",
    grantReason: "专用端到端测试教师",
  });
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
