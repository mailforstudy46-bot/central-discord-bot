import 'dotenv/config';
import mongoose from 'mongoose';
import express from 'express';
import bodyParser from 'body-parser';
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { EmbedBuilder } from 'discord.js';

// ───── Mongo Schema ─────
const userSchema = new mongoose.Schema({
  discordId: { type: String, unique: true, required: true },
  username: String,
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  lastMessage: { type: String, default: "" },
  words: [{ word: String, addedBy: String }]
});
const User = mongoose.model('User', userSchema);

// ───── Connect MongoDB ─────
const mongoUri = process.env.MONGO_URI;

if (!mongoUri) {
  console.error("❌ MONGO_URI is missing");
  process.exit(1);
}

await mongoose.connect(mongoUri);;

// ───── Discord Client ─────
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

function xpToLevel(xp) {
  return Math.floor(xp / 100) + 1;
}

async function addXp(userId, username, xpGain) {
  let user = await User.findOne({ discordId: userId });
  if (!user) {
    user = await User.create({ discordId: userId, username, xp: 0, level: 1, lastMessage: "" });
  }
  user.xp += xpGain;
  const newLevel = xpToLevel(user.xp);
  const leveled = newLevel > user.level;
  user.level = newLevel;
  user.lastMessage = username;
  await user.save();
  return { user, leveled, gainedXp: xpGain };
}

const XP_CHANNELS = ['1453426775689527494','1429903344264151160'];

const ROLE_REWARD_IDS = {
  2000: "1453425707588911356",
  1500: "1453425615154839747",
  1200: "1453425583319945458",
  900:  "1453425557260861461",
  500:  "1453425519214203013",
  400:  "1453425495843672114",
  300:  "1453423167464018040",
  200:  "1453423017446346782",
  100:  "1453422914203287763",
  0:    "1453422839201009866"
};

async function updateRoles(member, xp, channel) {
  const tiers = Object.keys(ROLE_REWARD_IDS).map(Number).sort((a,b)=>b-a);
  let newRole = null;
  for (const tier of tiers) {
    if (xp >= tier) { newRole = ROLE_REWARD_IDS[tier]; break; }
  }
  if (!newRole) return;
  for (const tier of tiers) {
    const roleId = ROLE_REWARD_IDS[tier];
    if (member.roles.cache.has(roleId) && roleId !== newRole) {
      await member.roles.remove(roleId).catch(()=>{});
    }
  }
  if (!member.roles.cache.has(newRole)) {
    await member.roles.add(newRole).catch(()=>{});
    const msg = await channel.send(`🎀 ได้ยศใหม่ตาม XP ${xp} แล้วค่ะ 💗`);
    setTimeout(()=>msg.delete().catch(()=>{}),4000);
  }
}

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!XP_CHANNELS.includes(message.channel.id)) return;

  let user = await User.findOne({ discordId: message.author.id });
  if (!user) {
    user = await User.create({ discordId: message.author.id, username: message.author.tag, xp:0, level:1, lastMessage:"", words:[] });
  }

  if (user.lastMessage === message.content) return;
  if (user.words.some(w => w.word === message.content)) return;

  const engMatch = message.content.match(/[A-Za-z0-9]+/g);
  if (!engMatch) return;

  const engText = engMatch.join(" ");
  const xpGain = Math.min(engText.length, 200);
  const result = await addXp(message.author.id, message.author.tag, xpGain);
  if (!result.user) return;

  const xpMsg = await message.channel.send(`✨ +${xpGain} XP ให้ ${message.author.tag} แล้วค่ะ 💗`);
  setTimeout(()=>xpMsg.delete().catch(()=>{}),4000);

  const member = await message.guild.members.fetch(message.author.id).catch(()=>null);
  if (member) await updateRoles(member, result.user.xp, message.channel);

  if (result.leveled) {
    const levelUpMsg = await message.channel.send(`🎉 ${message.author.tag} เลเวลอัปเป็นขั้น ${result.user.level} แล้วค่ะ 💗✨`);
    setTimeout(()=>levelUpMsg.delete().catch(()=>{}),6000);
  }
});

const commands = [
  new SlashCommandBuilder().setName('xp').setDescription('ดู XP/Level')
    .addUserOption(opt => opt.setName('user').setDescription('เลือกผู้ใช้').setRequired(false)),
  new SlashCommandBuilder().setName('leaderboard').setDescription('ดูอันดับ XP'),
  new SlashCommandBuilder().setName('addword').setDescription('เพิ่มคำศัพท์')
    .addStringOption(opt => opt.setName('word').setDescription('คำศัพท์').setRequired(true)),
  new SlashCommandBuilder().setName('resetlevel').setDescription('รีเซต XP/Level'),
  new SlashCommandBuilder().setName('profile').setDescription('ดูการ์ดโปรไฟล์'),
  new SlashCommandBuilder().setName('help').setDescription('ดูคำสั่งและวิธีใช้ระบบ XP')
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), {
  body: commands
});
console.log('✅ Slash Commands Registered');

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = interaction.commandName;
  const channel = interaction.channel;

  if (cmd === 'profile') {
    const doc = await User.findOne({ discordId: interaction.user.id });
    if (!doc) {
      return interaction.reply({ content: "🥺 ยังไม่มีข้อมูล XP ของคุณค่ะ", flags: 64 });
    }
    const xp = doc.xp;
    const level = doc.level;
    const next = (level+1)*100;
    const percent = Math.min(xp/next,1)*100;

    const embed = new EmbedBuilder()
      .setTitle("🌸 Profile Card ✨")
      .setThumbnail(interaction.user.displayAvatarURL())
      .setDescription(`💗 XP: ${xp}\n🌷 ขั้น: ${level}\n⚡ Progress: ${percent.toFixed(0)}%`)

    return interaction.reply({ content:"นี่การ์ดของคุณค่ะ 💗", embeds:[embed], flags:64 });
  }

  if (cmd === 'leaderboard') {
    const top = await User.find().sort({xp:-1}).limit(10);
    const lb = top.map((u,i)=>`👑 ${i+1}. ${u.username} — ${u.xp} XP`).join("\n") || "ยังไม่มีข้อมูลค่ะ";
    const embed = new EmbedBuilder()
      .setTitle("👑 Leaderboard XP")
      .setDescription(lb)
    return interaction.reply({ embeds:[embed], flags:64 });
  }

  if (cmd === 'addword') {
    const word = interaction.options.getString('word');
    let doc = await User.findOne({discordId:interaction.user.id});
    if(!doc) doc = await User.create({discordId:interaction.user.id,username:interaction.user.tag});
    if(!doc.words.some(w=>w.word===word)){
      doc.words.push({word,addedBy:interaction.user.tag});
      await doc.save();
    }
    return interaction.reply({ content:`🍰 จำคำว่า "${word}" แล้วค่ะ 💗`, flags:64 });
  }

  if (cmd === 'resetlevel') {
    await User.findOneAndUpdate({discordId:interaction.user.id},{xp:0,level:1,lastMessage:""});
    return interaction.reply({ content:"🌱 รีเซตแล้วค่ะ 💗✨", flags:64 });
  }

  if (cmd === 'help') {
  const helpEmbed = new EmbedBuilder()
    .setTitle("💗 คู่มือระบบ XP & ยศ ✨")
    .setDescription(
      "**ระบบโดยรวม:**\n" +
      "บอทจะเก็บ XP จากการพิมพ์ภาษาอังกฤษที่ไม่ซ้ำกัน (สูงสุด 200 XP/ข้อความ)\n" +
      "ทุก 100 XP = 1 ขั้น Level และจะได้รับยศอัตโนมัติตาม XP ที่มี\n\n" +
      "**คำสั่งที่ใช้ได้:**\n" +
      "`/xp [@user]` → ดู XP/Level\n" +
      "`/leaderboard` → ดูอันดับ XP\n" +
      "`/profile` → ดูการ์ดโปรไฟล์ของตัวเอง\n" +
      "`/addword <word>` → เพิ่มคำศัพท์ใหม่เพื่อทบทวน\n" +
      "`/delword <index>` → ลบคำศัพท์ตามลำดับ\n" +
      "`/clearwords` → ลบคลังคำศัพท์ทั้งหมด\n" +
      "`/resetlevel` → รีเซต XP/Level\n" +
      "`/reviewwords` → ดูคลังคำศัพท์ที่เก็บไว้"
    )
    .setFooter({ text: "XP Mentor Guide 💖" })
    .setTimestamp();

  return interaction.reply({ embeds: [helpEmbed], flags: 64 }); // กระซิบ ไม่แจ้งเตือนค่ะ
}

});

// Webhook
const app = express();
app.use(bodyParser.json());
app.post('/webhook/apollo', async (req,res)=>{
  try{
    const g = await client.guilds.fetch(req.body.guildId).catch(()=>null);
    const c = g?await g.channels.fetch(req.body.channelId).catch(()=>null):null;
    if(c?.isTextBased()) await c.send(`📡 Event: ${req.body.title} @ ${req.body.startTime} 💗`);
    res.sendStatus(200);
  }catch{res.sendStatus(500);}
});
app.listen(3000,()=>console.log("Webhook ready"));

client.login(process.env.DISCORD_TOKEN);

