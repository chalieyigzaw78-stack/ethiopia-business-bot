import dotenv from 'dotenv';
dotenv.config();

import { Telegraf, Markup } from 'telegraf';
import { Pool } from 'pg';
import * as http from 'http';

const BOT_TOKEN = process.env.BOT_TOKEN!;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID!;
const GROQ_API_KEY = process.env.GROQ_API_KEY!;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const askAI = async (userMessage: string): Promise<string> => {
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + GROQ_API_KEY
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'system',
            content: 'You are a male business idea advisor for Ethiopia. You ONLY respond in English regardless of what language the user writes in. You help Ethiopian entrepreneurs with creative, practical business ideas. Suggest realistic business ideas suitable for Ethiopia considering the local market, culture, and economy. Include estimated startup cost in Ethiopian Birr, target customers, and potential monthly income. Be concise and practical.'
          },
          {
            role: 'user',
            content: userMessage
          }
        ],
        max_tokens: 600
      })
    });
    const data = await response.json() as any;
    if (data?.error) return '⚠️ Error: ' + (data.error.message || 'Unknown error');
    return data?.choices?.[0]?.message?.content || '⚠️ No response from AI.';
  } catch (err) {
    return '⚠️ AI is temporarily unavailable. Please try again later.';
  }
};

const initDB = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS biz_users (
      id SERIAL PRIMARY KEY,
      chat_id BIGINT UNIQUE NOT NULL,
      username VARCHAR(255),
      first_name VARCHAR(255),
      joined_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS biz_ideas (
      id SERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      first_name VARCHAR(255),
      title VARCHAR(500) NOT NULL,
      description TEXT NOT NULL,
      category VARCHAR(100) DEFAULT 'General',
      startup_cost VARCHAR(100),
      likes INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS biz_likes (
      id SERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      idea_id INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(chat_id, idea_id)
    );
  `);
  console.log('Database initialized');
};

const saveUser = async (chatId: number, username: string, firstName: string) => {
  await pool.query(
    'INSERT INTO biz_users (chat_id, username, first_name) VALUES ($1, $2, $3) ON CONFLICT (chat_id) DO NOTHING',
    [chatId, username, firstName]
  );
};

const isAdmin = (chatId: number) => String(chatId) === String(ADMIN_CHAT_ID);

const bot = new Telegraf(BOT_TOKEN);

const mainMenu = Markup.keyboard([
  ['💡 Browse Ideas', '✍️ Submit My Idea'],
  ['👨‍💼 Ask AI', '🏆 Top Ideas'],
  ['📂 Categories', '🔍 Search Ideas'],
  ['👥 Community', '❓ Help'],
]).resize();

const adminMenu = Markup.keyboard([
  ['💡 Browse Ideas', '✍️ Submit My Idea'],
  ['👨‍💼 Ask AI', '🏆 Top Ideas'],
  ['📂 Categories', '🔍 Search Ideas'],
  ['👥 Community', '❓ Help'],
  ['📊 Stats', '🗑️ Admin'],
]).resize();

bot.start(async (ctx) => {
  const chatId = ctx.chat.id;
  const username = ctx.from?.username || '';
  const firstName = ctx.from?.first_name || '';
  await saveUser(chatId, username, firstName);
  const menu = isAdmin(chatId) ? adminMenu : mainMenu;
  ctx.reply(
    '👋 Welcome ' + firstName + '!\n\n' +
    '💼 Ethiopia Business Ideas Bot\n\n' +
    'Discover, share, and vote on the best\n' +
    'business ideas for Ethiopia!\n\n' +
    '💡 Browse ideas from the community\n' +
    '✍️ Share your own business idea\n' +
    '👨‍💼 Get AI-generated business ideas\n' +
    '🏆 See the top voted ideas\n\n' +
    'Choose an option below:',
    menu
  );
});

bot.hears('💡 Browse Ideas', async (ctx) => {
  try {
    const result = await pool.query(
      'SELECT * FROM biz_ideas ORDER BY created_at DESC LIMIT 5'
    );
    if (result.rows.length === 0) return ctx.reply('No ideas yet! Be the first to submit one using ✍️ Submit My Idea', mainMenu);
    ctx.reply('💡 Latest Business Ideas:\n─────────────────');
    for (const idea of result.rows) {
      const msg =
        '💡 ' + idea.title + '\n' +
        '📂 ' + idea.category + '\n' +
        '👤 ' + (idea.first_name || 'Anonymous') + '\n\n' +
        '📝 ' + idea.description + '\n\n' +
        (idea.startup_cost ? '💰 Startup Cost: ' + idea.startup_cost + '\n' : '') +
        '❤️ ' + idea.likes + ' likes  |  ID: #' + idea.id + '\n' +
        '─────────────────';
      await ctx.reply(msg);
    }
    ctx.reply('To like an idea type: /like_1 (replace 1 with idea ID)', mainMenu);
  } catch {
    ctx.reply('⚠️ Could not load ideas right now.', mainMenu);
  }
});

bot.hears('🏆 Top Ideas', async (ctx) => {
  try {
    const result = await pool.query(
      'SELECT * FROM biz_ideas ORDER BY likes DESC LIMIT 5'
    );
    if (result.rows.length === 0) return ctx.reply('No ideas yet! Be the first to submit one.', mainMenu);
    ctx.reply('🏆 Top Voted Business Ideas:\n─────────────────');
    for (const [i, idea] of result.rows.entries()) {
      const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
      const msg =
        medals[i] + ' ' + idea.title + '\n' +
        '📂 ' + idea.category + '\n' +
        '👤 ' + (idea.first_name || 'Anonymous') + '\n\n' +
        '📝 ' + idea.description + '\n\n' +
        (idea.startup_cost ? '💰 Startup Cost: ' + idea.startup_cost + '\n' : '') +
        '❤️ ' + idea.likes + ' likes  |  ID: #' + idea.id + '\n' +
        '─────────────────';
      await ctx.reply(msg);
    }
    ctx.reply('To like an idea type: /like_1 (replace 1 with idea ID)', mainMenu);
  } catch {
    ctx.reply('⚠️ Could not load top ideas.', mainMenu);
  }
});

bot.hears('📂 Categories', (ctx) => {
  ctx.reply(
    '📂 Business Idea Categories:\n\n' +
    '🌾  Agriculture\n' +
    '🍽️  Food & Beverage\n' +
    '👗  Fashion & Clothing\n' +
    '💻  Technology\n' +
    '🏥  Health & Wellness\n' +
    '📚  Education\n' +
    '🏠  Real Estate\n' +
    '🚗  Transport\n' +
    '🛒  Retail & Trade\n' +
    '🎭  Entertainment\n' +
    '💼  Services\n\n' +
    'Tap 🔍 Search Ideas and type a category to browse.',
    mainMenu
  );
});

bot.hears('🔍 Search Ideas', (ctx) => {
  ctx.reply('Type your search keyword:\nExample: agriculture', Markup.forceReply());
});

bot.hears('👥 Community', async (ctx) => {
  try {
    const users = await pool.query('SELECT COUNT(*) FROM biz_users');
    const ideas = await pool.query('SELECT COUNT(*) FROM biz_ideas');
    ctx.reply(
      '👥 Ethiopia Business Ideas Community:\n\n' +
      '👤 Total Members: ' + users.rows[0].count + '\n' +
      '💡 Total Ideas Shared: ' + ideas.rows[0].count + '\n\n' +
      'Join us and share your business idea!\n' +
      'Tap ✍️ Submit My Idea to get started.',
      mainMenu
    );
  } catch {
    ctx.reply('⚠️ Could not load community stats.', mainMenu);
  }
});

bot.hears('❓ Help', (ctx) => {
  ctx.reply(
    '📖 How to use Ethiopia Business Ideas Bot:\n\n' +
    '💡 Browse Ideas — see latest ideas\n' +
    '✍️ Submit My Idea — share your idea\n' +
    '👨‍💼 Ask AI — get AI business suggestions\n' +
    '🏆 Top Ideas — most liked ideas\n' +
    '📂 Categories — browse by category\n' +
    '🔍 Search Ideas — search by keyword\n' +
    '👥 Community — see member stats\n\n' +
    'To like an idea: type /like_1\n' +
    '(replace 1 with the idea ID number)',
    mainMenu
  );
});

bot.hears('👨‍💼 Ask AI', (ctx) => {
  ctx.reply(
    '👨‍💼 AI Business Idea Advisor!\n\n' +
    'Tell me your interests or situation\n' +
    'and I will suggest a business idea!\n\n' +
    'Examples:\n' +
    '• I have 5000 birr to invest\n' +
    '• I am good at cooking\n' +
    '• I want an online business\n' +
    '• I am in Addis Ababa with no capital\n' +
    '• I want to start in agriculture\n\n' +
    'Just type your situation! 👇'
  );
});

bot.hears('✍️ Submit My Idea', (ctx) => {
  ctx.reply(
    '✍️ Share your business idea!\n\n' +
    'Send in this format:\n\n' +
    'TITLE: Your idea title\n' +
    'CATEGORY: Agriculture\n' +
    'COST: 10000 ETB\n' +
    'DESCRIPTION: Describe your idea here\n\n' +
    'Categories: Agriculture, Food, Fashion, Technology, Health, Education, Real Estate, Transport, Retail, Entertainment, Services\n\n' +
    'Example:\n' +
    'TITLE: Mobile Vegetable Delivery\n' +
    'CATEGORY: Food\n' +
    'COST: 15000 ETB\n' +
    'DESCRIPTION: Deliver fresh vegetables to homes in Addis Ababa using a bicycle.'
  );
});

bot.hears('📊 Stats', async (ctx) => {
  if (!isAdmin(ctx.chat.id)) return ctx.reply('⛔ Admin only.', mainMenu);
  try {
    const users = await pool.query('SELECT COUNT(*) FROM biz_users');
    const ideas = await pool.query('SELECT COUNT(*) FROM biz_ideas');
    const today = await pool.query(
      "SELECT COUNT(*) FROM biz_ideas WHERE created_at >= NOW() - INTERVAL '24 hours'"
    );
    const likes = await pool.query('SELECT SUM(likes) FROM biz_ideas');
    ctx.reply(
      '📊 Ethiopia Business Bot Stats:\n\n' +
      '👤 Total Members: ' + users.rows[0].count + '\n' +
      '💡 Total Ideas: ' + ideas.rows[0].count + '\n' +
      '📅 Ideas Today: ' + today.rows[0].count + '\n' +
      '❤️ Total Likes: ' + (likes.rows[0].sum || 0)
    );
  } catch {
    ctx.reply('⚠️ Could not load stats.');
  }
});

bot.command(/like_(\d+)/, async (ctx) => {
  const ideaId = parseInt((ctx.match as any)[1]);
  const chatId = ctx.chat.id;
  try {
    const idea = await pool.query('SELECT * FROM biz_ideas WHERE id = $1', [ideaId]);
    if (idea.rows.length === 0) return ctx.reply('⚠️ Idea #' + ideaId + ' not found.');
    await pool.query(
      'INSERT INTO biz_likes (chat_id, idea_id) VALUES ($1, $2)',
      [chatId, ideaId]
    );
    await pool.query('UPDATE biz_ideas SET likes = likes + 1 WHERE id = $1', [ideaId]);
    ctx.reply('❤️ You liked idea #' + ideaId + ': ' + idea.rows[0].title + '!', mainMenu);
  } catch {
    ctx.reply('⚠️ You already liked this idea!', mainMenu);
  }
});

bot.on('text', async (ctx) => {
  const text = (ctx.message as any)?.text || '';
  if (text.startsWith('/')) return;

  if (text.includes('TITLE:') && text.includes('DESCRIPTION:')) {
    try {
      const getField = (field: string): string | null => {
        const regex = new RegExp(field + ':\\s*([\\s\\S]+?)(?=\\n[A-Z]+:|$)');
        const match = text.match(regex);
        return match ? match[1].trim() : null;
      };
      const title = getField('TITLE');
      const category = getField('CATEGORY') || 'General';
      const cost = getField('COST');
      const description = getField('DESCRIPTION');
      if (!title || !description) return ctx.reply('⚠️ Please include TITLE and DESCRIPTION.');
      const firstName = ctx.from?.first_name || 'Anonymous';
      await pool.query(
        'INSERT INTO biz_ideas (chat_id, first_name, title, description, category, startup_cost) VALUES ($1, $2, $3, $4, $5, $6)',
        [ctx.chat.id, firstName, title, description, category, cost]
      );
      ctx.reply(
        '✅ Your business idea has been submitted!\n\n' +
        '💡 ' + title + '\n' +
        '📂 ' + category + '\n\n' +
        'Other members can now see and like your idea!\n' +
        'Tap 💡 Browse Ideas to see it.',
        mainMenu
      );
    } catch {
      ctx.reply('⚠️ Failed to submit idea. Try again.');
    }
    return;
  }

  try {
    const result = await pool.query(
      'SELECT * FROM biz_ideas WHERE title ILIKE $1 OR description ILIKE $1 OR category ILIKE $1 ORDER BY likes DESC LIMIT 5',
      ['%' + text + '%']
    );
    if (result.rows.length > 0) {
      ctx.reply('🔍 Results for "' + text + '":\n─────────────────');
      for (const idea of result.rows) {
        const msg =
          '💡 ' + idea.title + '\n' +
          '📂 ' + idea.category + '\n' +
          '👤 ' + (idea.first_name || 'Anonymous') + '\n\n' +
          '📝 ' + idea.description + '\n\n' +
          (idea.startup_cost ? '💰 Startup Cost: ' + idea.startup_cost + '\n' : '') +
          '❤️ ' + idea.likes + ' likes  |  ID: #' + idea.id + '\n' +
          '─────────────────';
        await ctx.reply(msg);
      }
      ctx.reply('To like an idea type: /like_1 (replace 1 with idea ID)', mainMenu);
      return;
    }
  } catch {}

  await ctx.reply('👨‍💼 Let me think of a business idea for you...');
  const aiResponse = await askAI(text);
  ctx.reply('👨‍💼 AI Advisor:\n\n' + aiResponse, mainMenu);
});

const start = async () => {
  await initDB();
  bot.launch();
  console.log('Ethiopia Business Bot is running!');
  const PORT = process.env.PORT || 3000;
  http.createServer((_: any, res: any) => {
    res.writeHead(200);
    res.end('Ethiopia Business Bot is running!');
  }).listen(PORT, () => {
    console.log('HTTP server listening on port ' + PORT);
  });
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
};

start();
