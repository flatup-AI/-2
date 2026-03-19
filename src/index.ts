import bolt from '@slack/bolt';
import type { Block, KnownBlock } from '@slack/types';
import cron from 'node-cron';
import process from 'node:process';

type Role = '管理者' | 'メンバー';

type Member = {
  id: string;
  name: string;
  role: Role;
  department: string;
};

type Fortune = {
  title: string;
  text: string;
};

type MorningEntry = {
  id: string;
  userId: string;
  userName: string;
  department: string;
  date: string;
  mood: number;
  condition: number;
  work: string;
  guideline: string;
  fortuneTitle: string;
  fortuneText: string;
  aiComment: string;
  createdAt: string;
};

type EveningEntry = {
  id: string;
  userId: string;
  userName: string;
  department: string;
  date: string;
  completion: number;
  review: string;
  reward: string;
  createdAt: string;
};

type AppConfig = {
  slackBotToken: string;
  slackSigningSecret: string;
  slackAppToken?: string;
  slackUseSocketMode: boolean;
  slackPublicChannelId: string;
  slackAdminUserIds: string[];
  port: number;
  timezone: string;
};

const actionGuidelines = [
  '明るく元気な挨拶を自分からする',
  '時間厳守（5分前行動・10分前集合）',
  '報告・連絡・相談を徹底する',
  '嘘をつかず信用を守る',
  '仲間と協力業者を大切にする',
  '整理整頓を徹底する',
  '気付いたらすぐ行動する',
  '相手の為に一生懸命考える',
  '感謝を忘れない',
  '仲間と意見交換をする',
  '状況を察して行動する',
  '常に新しい可能性に挑戦する',
] as const;

const fortunes: Fortune[] = [
  { title: '大吉', text: '今日は一歩先の気配りが信頼につながる日です。先手の行動が大きな成果を呼びます。' },
  { title: '中吉', text: '焦らず丁寧に進めることで、周囲との連携が噛み合う一日になりそうです。' },
  { title: '小吉', text: '小さな改善が大きな成果のきっかけになります。整理整頓が運気アップの鍵です。' },
  { title: '吉', text: '報連相を意識すると、仕事がスムーズに進みます。早めの共有が幸運のポイントです。' },
  { title: '末吉', text: '無理をせず基本を丁寧に積み重ねることが、今日の好結果につながります。' },
];

const goodEveningMessages = [
  '素晴らしい一日でした！今日の積み重ねが未来をつくります。',
  'フラットアップ魂、最高です。今日も信頼をしっかり積み上げました！',
  'しっかり達成、お見事です！この調子で明日も前進していきましょう。',
  '今日の行動が会社の品質を高めています。ナイスワークです！',
  '一日のやり切り、素敵です。努力は必ず次の成果につながります。',
  'お疲れさまでした！今日の仕事はきっと誰かの安心につながっています。',
] as const;

const aiCommentByGuideline: Record<string, string> = {
  '明るく元気な挨拶を自分からする': '今日のテーマは「挨拶」です。空気を変えるのは、いつも最初のひと言です。あなたから良い一日を始めましょう。',
  '時間厳守（5分前行動・10分前集合）': '今日のテーマは「時間厳守」です。5分前の意識が段取りの質と信頼を高めます。',
  '報告・連絡・相談を徹底する': '今日のテーマは「報連相」です。早めの共有は、チーム全体の安心と成果につながります。',
  '嘘をつかず信用を守る': '今日のテーマは「信用」です。誠実な一つひとつの行動が、会社の信用を守ります。',
  '仲間と協力業者を大切にする': '今日のテーマは「仲間を大切にする」です。思いやりのあるひと言と行動が現場を強くします。',
  '整理整頓を徹底する': '今日のテーマは「整理整頓」です。整った環境は、整った仕事につながります。',
  '気付いたらすぐ行動する': '今日のテーマは「すぐ行動」です。先手の一歩が信頼とスピードを生みます。',
  '相手の為に一生懸命考える': '今日のテーマは「相手の為に考える」です。そのひと手間が、心に残る仕事をつくります。',
  '感謝を忘れない': '今日のテーマは「感謝」です。感謝のある言葉と姿勢は、職場の空気を良くします。',
  '仲間と意見交換をする': '今日のテーマは「意見交換」です。良い対話が、より良い仕事のスタートです。',
  '状況を察して行動する': '今日のテーマは「察して動く」です。今なにが必要かを考えて動ける人が信頼を集めます。',
  '常に新しい可能性に挑戦する': '今日のテーマは「挑戦」です。現状に満足しない一歩が、会社の未来をつくります。',
};

const fixedMembers: Member[] = [
  { id: 'staff-1', name: '上平 幸男', role: '管理者', department: '代表' },
  { id: 'staff-2', name: '丸山 裕輔', role: 'メンバー', department: 'スタッフ' },
  { id: 'staff-3', name: '前川 梨花', role: 'メンバー', department: 'スタッフ' },
  { id: 'staff-4', name: '阿部 江美', role: 'メンバー', department: 'スタッフ' },
  { id: 'staff-5', name: '青木 美里', role: 'メンバー', department: 'スタッフ' },
  { id: 'staff-6', name: '中島 さくら', role: 'メンバー', department: 'スタッフ' },
];

const slackUserMap = new Map<string, Member>();
const morningEntries = new Map<string, MorningEntry>();
const eveningEntries = new Map<string, EveningEntry>();

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function readConfig(env = process.env): AppConfig {
  const slackUseSocketMode = parseBoolean(env.SLACK_USE_SOCKET_MODE, true);
  return {
    slackBotToken: env.SLACK_BOT_TOKEN || '',
    slackSigningSecret: env.SLACK_SIGNING_SECRET || '',
    slackAppToken: env.SLACK_APP_TOKEN || undefined,
    slackUseSocketMode,
    slackPublicChannelId: env.SLACK_PUBLIC_CHANNEL_ID || '',
    slackAdminUserIds: (env.SLACK_ADMIN_USER_IDS || '').split(',').map((v) => v.trim()).filter(Boolean),
    port: Number(env.PORT || 3000),
    timezone: env.TZ || 'Asia/Tokyo',
  };
}

function validateConfig(config: AppConfig): string[] {
  const errors: string[] = [];
  if (!config.slackBotToken) errors.push('SLACK_BOT_TOKEN が未設定です。');
  if (!config.slackSigningSecret) errors.push('SLACK_SIGNING_SECRET が未設定です。');
  if (config.slackUseSocketMode && !config.slackAppToken) errors.push('Socket Mode を使う場合は SLACK_APP_TOKEN が必要です。');
  if (!config.slackPublicChannelId) errors.push('SLACK_PUBLIC_CHANNEL_ID が未設定です。');
  if (!Number.isFinite(config.port) || config.port <= 0) errors.push('PORT は正の数で指定してください。');
  return errors;
}

function todayJst(now = new Date(), timezone = 'Asia/Tokyo'): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function makeKey(userId: string, date: string): string {
  return `${userId}__${date}`;
}

function pickFortune(): Fortune {
  return fortunes[Math.floor(Math.random() * fortunes.length)];
}

function pickReward(score: number): string {
  if (score >= 5) return goodEveningMessages[Math.floor(Math.random() * goodEveningMessages.length)];
  if (score === 4) return 'いい仕事でした！あと一歩の積み重ねが、さらに大きな成果になります。';
  if (score === 3) return 'まずまずの一日でした。振り返りを活かして明日はさらに良くしていきましょう。';
  if (score === 2) return '今日は伸びしろのある一日でした。明日は一つでも前進できれば十分です。';
  return '今日はしっかり休んで、明日またリスタートしましょう。';
}

function resolveMember(slackUserId: string, adminUserIds: Set<string>, slackRealName?: string): Member {
  const cached = slackUserMap.get(slackUserId);
  if (cached) return cached;

  const found = fixedMembers.find((m) => m.name === slackRealName);
  if (found) {
    slackUserMap.set(slackUserId, found);
    return found;
  }

  const fallback: Member = {
    id: `dynamic-${slackUserId}`,
    name: slackRealName || '未登録スタッフ',
    role: adminUserIds.has(slackUserId) ? '管理者' : 'メンバー',
    department: 'スタッフ',
  };
  slackUserMap.set(slackUserId, fallback);
  return fallback;
}

function moodText(value?: number): string {
  return ['-', 'かなり低い', 'やや低い', '普通', '良い', 'とても良い'][value || 0] || '-';
}

function completionText(value?: number): string {
  return ['-', 'ほぼ未達', 'やや未達', '普通', 'ほぼ達成', 'しっかり達成'][value || 0] || '-';
}

function toBlocks(input: (KnownBlock | Block)[]): (KnownBlock | Block)[] {
  return input;
}

function buildHomeView(member: Member, slackUserId: string, timezone = 'Asia/Tokyo') {
  const date = todayJst(new Date(), timezone);
  const morning = morningEntries.get(makeKey(slackUserId, date));
  const evening = eveningEntries.get(makeKey(slackUserId, date));

  const teamMorningCount = Array.from(morningEntries.values()).filter((v) => v.date === date).length;
  const teamEveningCount = Array.from(eveningEntries.values()).filter((v) => v.date === date).length;

  const latestPosts = [
    ...Array.from(morningEntries.values()).map((v) => ({
      type: '朝礼',
      createdAt: v.createdAt,
      text: `*${v.userName}*｜気分:${v.mood}/5 体調:${v.condition}/5\n業務: ${v.work}\n意識: ${v.guideline}`,
    })),
    ...Array.from(eveningEntries.values()).map((v) => ({
      type: '終礼',
      createdAt: v.createdAt,
      text: `*${v.userName}*｜達成度:${v.completion}/5\n振り返り: ${v.review || 'なし'}\nコメント: ${v.reward}`,
    })),
  ]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  return {
    type: 'home' as const,
    blocks: toBlocks([
      { type: 'header', text: { type: 'plain_text', text: 'フラットアップ朝礼AI', emoji: true } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${member.name}* さん、おはようございます。\n今日は *${date}* です。Homeタブから朝礼・終礼を入力できます。`,
        },
      },
      {
        type: 'actions',
        elements: [
          { type: 'button', text: { type: 'plain_text', text: '朝礼を入力する', emoji: true }, style: 'primary', action_id: 'open_morning_modal' },
          { type: 'button', text: { type: 'plain_text', text: '終礼を入力する', emoji: true }, action_id: 'open_evening_modal' },
          { type: 'button', text: { type: 'plain_text', text: 'Homeを更新', emoji: true }, action_id: 'refresh_home' },
        ],
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*今日の朝礼*\n${morning ? '入力済み' : '未入力'}` },
          { type: 'mrkdwn', text: `*今日の終礼*\n${evening ? '入力済み' : '未入力'}` },
          { type: 'mrkdwn', text: `*チーム朝礼件数*\n${teamMorningCount} 件` },
          { type: 'mrkdwn', text: `*チーム終礼件数*\n${teamEveningCount} 件` },
        ],
      },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: '*あなたの今日の内容*' } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: morning
            ? `*朝礼*\n・気分: ${morning.mood}/5（${moodText(morning.mood)}）\n・体調: ${morning.condition}/5（${moodText(morning.condition)}）\n・業務: ${morning.work}\n・意識する行動指針: ${morning.guideline}\n・占い: ${morning.fortuneTitle}｜${morning.fortuneText}\n・AIコメント: ${morning.aiComment}`
            : 'まだ朝礼は投稿されていません。',
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: evening
            ? `*終礼*\n・達成度: ${evening.completion}/5（${completionText(evening.completion)}）\n・振り返り: ${evening.review || 'なし'}\n・フィードバック: ${evening.reward}`
            : 'まだ終礼は投稿されていません。',
        },
      },
      { type: 'divider' },
      { type: 'section', text: { type: 'mrkdwn', text: '*全員が見られる最新投稿*' } },
      ...(latestPosts.length
        ? latestPosts.flatMap((post) => [
            { type: 'section', text: { type: 'mrkdwn', text: `*${post.type}*\n${post.text}` } },
            { type: 'divider' },
          ])
        : [{ type: 'section', text: { type: 'mrkdwn', text: 'まだ共有投稿はありません。' } }]),
      ...(member.role === '管理者'
        ? [{ type: 'section', text: { type: 'mrkdwn', text: '*管理者メモ*\n投稿は共有チャンネルにも自動送信されます。' } }]
        : []),
    ]),
  };
}

function buildMorningModal() {
  return {
    type: 'modal' as const,
    callback_id: 'morning_submit',
    title: { type: 'plain_text', text: '朝礼入力', emoji: true },
    submit: { type: 'plain_text', text: '投稿する', emoji: true },
    close: { type: 'plain_text', text: '閉じる', emoji: true },
    blocks: toBlocks([
      {
        type: 'input',
        block_id: 'mood_block',
        label: { type: 'plain_text', text: '① 本日の気分', emoji: true },
        element: {
          type: 'static_select',
          action_id: 'mood_action',
          initial_option: { text: { type: 'plain_text', text: '3｜普通' }, value: '3' },
          options: [1, 2, 3, 4, 5].map((n) => ({ text: { type: 'plain_text', text: `${n}｜${moodText(n)}` }, value: String(n) })),
        },
      },
      {
        type: 'input',
        block_id: 'condition_block',
        label: { type: 'plain_text', text: '① 本日の体調', emoji: true },
        element: {
          type: 'static_select',
          action_id: 'condition_action',
          initial_option: { text: { type: 'plain_text', text: '3｜普通' }, value: '3' },
          options: [1, 2, 3, 4, 5].map((n) => ({ text: { type: 'plain_text', text: `${n}｜${moodText(n)}` }, value: String(n) })),
        },
      },
      {
        type: 'input',
        block_id: 'work_block',
        label: { type: 'plain_text', text: '② 本日の業務内容', emoji: true },
        element: {
          type: 'plain_text_input',
          action_id: 'work_action',
          multiline: true,
          placeholder: { type: 'plain_text', text: '今日やる仕事を入力してください' },
        },
      },
      {
        type: 'input',
        block_id: 'guideline_block',
        label: { type: 'plain_text', text: '③ 特に気を付ける行動指針', emoji: true },
        element: {
          type: 'static_select',
          action_id: 'guideline_action',
          options: actionGuidelines.map((g, i) => ({ text: { type: 'plain_text', text: `${i + 1}. ${g}`.slice(0, 75) }, value: g })),
        },
      },
    ]),
  };
}

function buildEveningModal() {
  return {
    type: 'modal' as const,
    callback_id: 'evening_submit',
    title: { type: 'plain_text', text: '終礼入力', emoji: true },
    submit: { type: 'plain_text', text: '記録する', emoji: true },
    close: { type: 'plain_text', text: '閉じる', emoji: true },
    blocks: toBlocks([
      {
        type: 'input',
        block_id: 'completion_block',
        label: { type: 'plain_text', text: '⑤ 本日の業務予定を完了できたか', emoji: true },
        element: {
          type: 'static_select',
          action_id: 'completion_action',
          initial_option: { text: { type: 'plain_text', text: '3｜普通' }, value: '3' },
          options: [1, 2, 3, 4, 5].map((n) => ({ text: { type: 'plain_text', text: `${n}｜${completionText(n)}` }, value: String(n) })),
        },
      },
      {
        type: 'input',
        optional: true,
        block_id: 'review_block',
        label: { type: 'plain_text', text: '振り返り・明日への申し送り', emoji: true },
        element: {
          type: 'plain_text_input',
          action_id: 'review_action',
          multiline: true,
          placeholder: { type: 'plain_text', text: '未完了業務、共有事項など' },
        },
      },
    ]),
  };
}

const { App, LogLevel } = bolt;

async function main() {
  const config = readConfig();
  const errors = validateConfig(config);
  if (errors.length > 0) {
    console.error('Slackアプリを起動できません。設定を確認してください。');
    errors.forEach((e) => console.error(`- ${e}`));
    process.exit(1);
  }

  const adminUserIds = new Set(config.slackAdminUserIds);

  const app = new App({
    token: config.slackBotToken,
    signingSecret: config.slackSigningSecret,
    socketMode: config.slackUseSocketMode,
    appToken: config.slackAppToken,
    logLevel: LogLevel.INFO,
  });

  async function publishHome(userId: string) {
    const info = await app.client.users.info({ user: userId });
    const realName = info.user?.real_name || info.user?.profile?.real_name || info.user?.name || 'スタッフ';
    const member = resolveMember(userId, adminUserIds, realName);

    await app.client.views.publish({
      user_id: userId,
      view: buildHomeView(member, userId, config.timezone),
    });
  }

  async function postSharedMorning(entry: MorningEntry) {
    await app.client.chat.postMessage({
      channel: config.slackPublicChannelId,
      text: `【朝礼】${entry.userName}｜${entry.date}`,
      blocks: toBlocks([
        { type: 'header', text: { type: 'plain_text', text: `【朝礼】${entry.userName}`, emoji: true } },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*日付*\n${entry.date}` },
            { type: 'mrkdwn', text: `*部署*\n${entry.department}` },
            { type: 'mrkdwn', text: `*気分*\n${entry.mood}/5（${moodText(entry.mood)}）` },
            { type: 'mrkdwn', text: `*体調*\n${entry.condition}/5（${moodText(entry.condition)}）` },
          ],
        },
        { type: 'section', text: { type: 'mrkdwn', text: `*本日の業務内容*\n${entry.work}` } },
        { type: 'section', text: { type: 'mrkdwn', text: `*本日意識する行動指針*\n${entry.guideline}` } },
        { type: 'section', text: { type: 'mrkdwn', text: `*今日の占い*\n${entry.fortuneTitle}｜${entry.fortuneText}` } },
        { type: 'section', text: { type: 'mrkdwn', text: `*AIコメント*\n${entry.aiComment}` } },
      ]),
    });
  }

  async function postSharedEvening(entry: EveningEntry) {
    await app.client.chat.postMessage({
      channel: config.slackPublicChannelId,
      text: `【終礼】${entry.userName}｜${entry.date}`,
      blocks: toBlocks([
        { type: 'header', text: { type: 'plain_text', text: `【終礼】${entry.userName}`, emoji: true } },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*日付*\n${entry.date}` },
            { type: 'mrkdwn', text: `*部署*\n${entry.department}` },
            { type: 'mrkdwn', text: `*達成度*\n${entry.completion}/5（${completionText(entry.completion)}）` },
            { type: 'mrkdwn', text: `*投稿時刻*\n${new Date(entry.createdAt).toLocaleTimeString('ja-JP', { timeZone: config.timezone })}` },
          ],
        },
        { type: 'section', text: { type: 'mrkdwn', text: `*振り返り・申し送り*\n${entry.review || 'なし'}` } },
        { type: 'section', text: { type: 'mrkdwn', text: `*フィードバック*\n${entry.reward}` } },
      ]),
    });
  }

  app.event('app_home_opened', async ({ event, logger }) => {
    try {
      await publishHome(event.user);
    } catch (error) {
      logger.error(error);
    }
  });

  app.action('refresh_home', async ({ ack, body, logger }) => {
    await ack();
    try {
      await publishHome(body.user.id);
    } catch (error) {
      logger.error(error);
    }
  });

  app.action('open_morning_modal', async ({ ack, body, client, logger }) => {
    await ack();
    try {
      await client.views.open({ trigger_id: body.trigger_id, view: buildMorningModal() });
    } catch (error) {
      logger.error(error);
    }
  });

  app.action('open_evening_modal', async ({ ack, body, client, logger }) => {
    await ack();
    try {
      await client.views.open({ trigger_id: body.trigger_id, view: buildEveningModal() });
    } catch (error) {
      logger.error(error);
    }
  });

  app.view('morning_submit', async ({ ack, body, view, client, logger }) => {
    await ack();
    try {
      const info = await client.users.info({ user: body.user.id });
      const realName = info.user?.real_name || info.user?.profile?.real_name || info.user?.name || 'スタッフ';
      const member = resolveMember(body.user.id, adminUserIds, realName);
      const fortune = pickFortune();

      const mood = Number(view.state.values.mood_block?.mood_action?.selected_option?.value || '3');
      const condition = Number(view.state.values.condition_block?.condition_action?.selected_option?.value || '3');
      const work = view.state.values.work_block?.work_action?.value || '';
      const guideline = view.state.values.guideline_block?.guideline_action?.selected_option?.value || actionGuidelines[0];
      const aiComment = aiCommentByGuideline[guideline] || '今日も前向きに取り組んでいきましょう。';

      const entry: MorningEntry = {
        id: `m_${Date.now()}`,
        userId: body.user.id,
        userName: member.name,
        department: member.department,
        date: todayJst(new Date(), config.timezone),
        mood,
        condition,
        work,
        guideline,
        fortuneTitle: fortune.title,
        fortuneText: fortune.text,
        aiComment,
        createdAt: new Date().toISOString(),
      };

      morningEntries.set(makeKey(body.user.id, entry.date), entry);
      await postSharedMorning(entry);
      await publishHome(body.user.id);
      await client.chat.postMessage({
        channel: body.user.id,
        text: `朝礼を受け付けました。今日の占いは ${fortune.title} です。`,
      });
    } catch (error) {
      logger.error(error);
    }
  });

  app.view('evening_submit', async ({ ack, body, view, client, logger }) => {
    await ack();
    try {
      const info = await client.users.info({ user: body.user.id });
      const realName = info.user?.real_name || info.user?.profile?.real_name || info.user?.name || 'スタッフ';
      const member = resolveMember(body.user.id, adminUserIds, realName);

      const completion = Number(view.state.values.completion_block?.completion_action?.selected_option?.value || '3');
      const review = view.state.values.review_block?.review_action?.value || '';
      const reward = pickReward(completion);

      const entry: EveningEntry = {
        id: `e_${Date.now()}`,
        userId: body.user.id,
        userName: member.name,
        department: member.department,
        date: todayJst(new Date(), config.timezone),
        completion,
        review,
        reward,
        createdAt: new Date().toISOString(),
      };

      eveningEntries.set(makeKey(body.user.id, entry.date), entry);
      await postSharedEvening(entry);
      await publishHome(body.user.id);
      await client.chat.postMessage({
        channel: body.user.id,
        text: '終礼を受け付けました。お疲れさまでした。',
      });
    } catch (error) {
      logger.error(error);
    }
  });

  async function notifyKnownUsers(kind: '朝礼' | '終礼') {
    const users = Array.from(slackUserMap.keys());
    if (users.length === 0) return;

    for (const userId of users) {
      const text = kind === '朝礼'
        ? '9:30です。Homeタブから朝礼を入力してください。'
        : '17:30です。Homeタブから終礼を入力してください。';
      await app.client.chat.postMessage({ channel: userId, text });
    }
  }

  cron.schedule('30 9 * * 1-5', async () => {
    await notifyKnownUsers('朝礼');
  }, { timezone: config.timezone });

  cron.schedule('30 17 * * 1-5', async () => {
    await notifyKnownUsers('終礼');
  }, { timezone: config.timezone });

  await app.start(config.port);
  console.log(`⚡️ Flatup Slack Home app is running on port ${config.port}`);
}

void main();
