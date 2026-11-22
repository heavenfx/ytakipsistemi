import { Client, Intents, Role, Guild, GuildMember, User, TextChannel } from 'discord.js-selfbot-v13';
import * as fs from 'fs';
import * as path from 'path';

interface TargetConfig {
    guildId: string;
    guildName?: string;
    roleIds: string[];
    autoDetectStaff?: boolean;
}

interface NotificationConfig {
    dmUserId?: string;
    logChannelId?: string;
    webhookUrl?: string;
    webhook_url?: string;
}

interface OptionConfig {
    trackAllGuilds?: boolean;
    autoDetectStaffRoles?: boolean;
    saveServerListOnStartup?: boolean;
}

interface BotConfig {
    token: string;
    checkIntervalSeconds: number;
    notifications: NotificationConfig;
    options: OptionConfig;
    targets: TargetConfig[];
}

export enum AlertType {
    RoleRemoved = 'role_removed',
    LeftServer = 'left_server'
}

interface AlertPayload {
    user: User | { id: string; tag?: string; username?: string };
    role: Role | { id: string; name: string };
    guild: Guild | { id: string; name: string };
    type: AlertType | 'role_removed' | 'left_server';
}

const configPath: string = path.join(__dirname, 'config.json');
let config: BotConfig = {
    token: '',
    checkIntervalSeconds: 30,
    notifications: {
        dmUserId: '',
        logChannelId: '',
        webhookUrl: ''
    },
    options: {
        trackAllGuilds: false,
        autoDetectStaffRoles: false,
        saveServerListOnStartup: true
    },
    targets: []
};

function loadConfig(): void {
    if (fs.existsSync(configPath)) {
        try {
            const raw: Partial<BotConfig> = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            config = {
                ...config,
                ...raw,
                notifications: {
                    ...config.notifications,
                    ...(raw.notifications || {})
                },
                options: {
                    ...config.options,
                    ...(raw.options || {})
                }
            };

            if ((raw as any).webhookUrl && !config.notifications.webhookUrl) {
                config.notifications.webhookUrl = (raw as any).webhookUrl;
            }
            if ((raw as any).dmUserId && !config.notifications.dmUserId) {
                config.notifications.dmUserId = (raw as any).dmUserId;
            }
            if ((raw as any).logChannelId && !config.notifications.logChannelId) {
                config.notifications.logChannelId = (raw as any).logChannelId;
            }
        } catch (e: any) {
            console.error('[HATA] config.json dosyası okunamadı:', e.message);
        }
    } else {
        console.warn('[UYARI] config.json bulunamadı. Lütfen config.json dosyasını oluşturun.');
    }
}

loadConfig();

const cacheFilePath: string = path.join(__dirname, 'cache.json');
let roleCache: Record<string, Record<string, Set<string>>> = {};

function loadCache(): void {
    if (fs.existsSync(cacheFilePath)) {
        try {
            const raw: Record<string, Record<string, string[]>> = JSON.parse(fs.readFileSync(cacheFilePath, 'utf8'));
            for (const [gid, roles] of Object.entries(raw)) {
                roleCache[gid] = {};
                for (const [rid, users] of Object.entries(roles)) {
                    roleCache[gid][rid] = new Set<string>(users);
                }
            }
        } catch (_) {
            roleCache = {};
        }
    }
}

function saveCache(): void {
    try {
        const serialized: Record<string, Record<string, string[]>> = {};
        for (const [gid, roles] of Object.entries(roleCache)) {
            serialized[gid] = {};
            for (const [rid, userSet] of Object.entries(roles)) {
                serialized[gid][rid] = Array.from(userSet);
            }
        }
        fs.writeFileSync(cacheFilePath, JSON.stringify(serialized, null, 2), 'utf8');
    } catch (err: any) {
        console.error('[HATA] cache.json yazılamadı:', err.message);
    }
}

loadCache();

function isStaffRole(role: Role | null | undefined): boolean {
    if (!role) return false;

    const perms: any = role.permissions;
    if (perms) {
        if (
            perms.includes('ADMINISTRATOR') ||
            perms.has('MANAGE_GUILD') ||
            perms.has('BAN_MEMBERS') ||
            perms.has('KICK_MEMBERS') ||
            perms.has('MANAGE_ROLES') ||
            perms.has('MANAGE_CHANNELS') ||
            perms.has('MANAGE_MESSAGES') ||
            perms.has('VIEW_AUDIT_LOG')
        ) {
            return true;
        }
    }

    const name: string = role.name.toLowerCase();
    const keywords: string[] = [
        'admin', 'mod', 'yetkili', 'staff', 'kurucu', 'yonetici', 'yönetici',
        'yönetim', 'destek', 'support', 'rehber', 'ekip', 'crew', 'owner',
        'founder', 'sorumlu', 'denetmen', 'asistan'
    ];
    return keywords.some((k: string) => name.includes(k));
}

const recentAlerts: Map<string, number> = new Map<string, number>();

function shouldSendAlert(userId: string, roleId: string): boolean {
    const key: string = `${userId}:${roleId}`;
    const now: number = Date.now();
    const last: number = recentAlerts.get(key) || 0;
    if (now - last < 60000) {
        return false;
    }
    recentAlerts.set(key, now);
    return true;
}

async function sendAlert({ user, role, guild, type }: AlertPayload): Promise<void> {
    if (!user || !role) return;
    if (!shouldSendAlert(user.id, role.id)) return;

    const nowSeconds: number = Math.floor(Date.now() / 1000);
    const isLeft: boolean = type === 'left_server' || type === AlertType.LeftServer;
    const statusText: string = isLeft ? 'Sunucudan Ayrıldı' : 'Yetki Rolü Alındı / Bıraktı';
    const userTag: string = (user as any).tag || (user as any).username || user.id;
    const guildName: string = guild?.name || 'Bilinmeyen Sunucu';
    const guildId: string = guild?.id || 'ID Yok';
    const roleName: string = role?.name || 'Bilinmeyen Rol';
    const roleId: string = role?.id || 'ID Yok';

    const timeStr: string = new Date().toLocaleTimeString('tr-TR');

    console.log(`---------------------------------------------------------------`);
    console.log(`[ALERT] [${timeStr}] [${guildName}]`);
    console.log(`Kullanıcı: ${userTag} (${user.id})`);
    console.log(`Rol: ${roleName} (${roleId})`);
    console.log(`Durum: ${statusText}`);
    console.log(`---------------------------------------------------------------`);

    try {
        const logLine: string = `[${new Date().toLocaleString('tr-TR')}] [Sunucu: ${guildName} (${guildId})] [Yetkili: ${userTag} (${user.id})] [Rol: ${roleName} (${roleId})] [Durum: ${statusText}]\n`;
        fs.appendFileSync(path.join(__dirname, 'logs.txt'), logLine, 'utf8');
    } catch (_) {}

    const formattedMessage: string = [
        `🚨 **[YETKİLİ TAKİP BİLDİRİMİ]** 🚨`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `👤 **Yetkili:** <@${user.id}> (\`${userTag}\` - \`${user.id}\`)`,
        `🛡️ **Ayrıldığı Rol:** **${roleName}** (\`${roleId}\`)`,
        `🌐 **Hedef Sunucu:** **${guildName}** (\`${guildId}\`)`,
        `⚠️ **İşlem Türü:** **${statusText}**`,
        `⏰ **Zaman:** <t:${nowSeconds}:f> (<t:${nowSeconds}:R>)`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    ].join('\n');

    let notificationSent: boolean = false;

    const dmUserId: string | undefined = config.notifications?.dmUserId;
    if (dmUserId && !dmUserId.includes('BURAYA_')) {
        try {
            const targetUser: User | null = await client.users.fetch(dmUserId).catch(() => null);
            if (targetUser) {
                await targetUser.send(formattedMessage);
                console.log(`[DM İLETİLDİ] Bildirim ${targetUser.tag} kullanıcısına DM ile gönderildi.`);
                notificationSent = true;
            } else {
                console.warn(`[UYARI] dmUserId (${dmUserId}) bulunamadı. Kullanıcı ile yan hesap arasında ortak sunucu veya açık DM olmalı.`);
            }
        } catch (err: any) {
            console.error(`[HATA] DM gönderilemedi (${dmUserId}):`, err.message);
        }
    }

    const logChannelId: string | undefined = config.notifications?.logChannelId;
    if (logChannelId && !logChannelId.includes('BURAYA_')) {
        try {
            const ch: any = await client.channels.fetch(logChannelId).catch(() => null);
            if (ch && ch.isText && ch.isText()) {
                await (ch as TextChannel).send(formattedMessage);
                console.log(`[KANAL LOGU İLETİLDİ] #${ch.name} kanalına bildirim gönderildi.`);
                notificationSent = true;
            } else {
                console.warn(`[UYARI] logChannelId (${logChannelId}) metin kanalı olarak bulunamadı.`);
            }
        } catch (err: any) {
            console.error(`[HATA] Kanala gönderilemedi (${logChannelId}):`, err.message);
        }
    }

    const webhookUrl: string | undefined = config.notifications?.webhook_url;
    if (webhookUrl && webhookUrl.startsWith('http') && !webhookUrl.includes('BURAYA_')) {
        const payload = {
            username: 'Yetkili Takip Sistemi',
            avatar_url: 'https://cdn.discordapp.com/emojis/1095457604156796939.png',
            embeds: [
                {
                    title: '🚨 Yetkili Rolden Ayrıldı',
                    color: 15548997,
                    description: `**${userTag}** hedef sunucudaki yetki rolünden ayrıldı!`,
                    fields: [
                        { name: 'Kullanıcı', value: `<@${user.id}> (${userTag})`, inline: true },
                        { name: 'Kullanıcı ID', value: `\`${user.id}\``, inline: true },
                        { name: 'Ayrıldığı Yetki', value: `**${roleName}** (\`${roleId}\`)`, inline: false },
                        { name: 'Hedef Sunucu', value: `**${guildName}** (\`${guildId}\`)`, inline: true },
                        { name: 'Ayrılma Şekli', value: statusText, inline: true },
                        { name: 'Tarih', value: `<t:${nowSeconds}:f> (<t:${nowSeconds}:R>)`, inline: false }
                    ],
                    footer: { text: 'Yetkili Takip Sistemi (Selfbot)' },
                    timestamp: new Date().toISOString()
                }
            ]
        };

        try {
            const response: Response = await fetch(webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                console.log(`[WEBHOOK İLETİLDİ] Webhook logu başarıyla gönderildi.`);
                notificationSent = true;
            } else {
                console.error(`[HATA] Webhook gönderilemedi! Status: ${response.status}`);
            }
        } catch (err: any) {
            console.error('[HATA] Webhook isteği başarısız:', err.message);
        }
    }

    if (!notificationSent) {
        console.warn(`[BİLGİ] Herhangi bir bildirim hedefi tanımlanmadığı için olay yalnızca konsola ve logs.txt dosyasına yazıldı.`);
    }
}

function exportServersAndRoles(): void {
    try {
        let output: string = `=== YAN HESABIN BULUNDUĞU SUNUCULAR VE ROLLER ===\n`;
        output += `Tarih: ${new Date().toLocaleString('tr-TR')}\n`;
        output += `Hesap: ${client.user?.tag} (${client.user?.id})\n`;
        output += `Toplam Sunucu Sayısı: ${client.guilds.cache.size}\n\n`;
        output += `KULLANIM REHBERİ:\n`;
        output += `Aşağıdaki Sunucu ID ve Rol ID'lerini kopyalayarak config.json dosyasındaki "targets" listesine ekleyebilirsiniz.\n\n`;

        clinet.guilds.cache.forEach((guild: Guild) => {
            output += `============================================================\n`;
            output += `SUNUCU ADI : ${guild.name}\n`;
            output += `SUNUCU ID  : ${guild.id}\n`;
            output += `ÜYE SAYISI : ${guild.memberCount}\n`;
            output += `------------------------------------------------------------\n`;
            output += `ROLLER:\n`;

            const roles = guild.roles.cache.sort((a: Role, b: Role) => b.position - a.position);
            roles.forEach((r: Role) => {
                if (r.id === guild.id) return;
                const staffMark = isStaffRole(r) ? '  <--- [YETKİLİ/YÖNETİCİ ROLÜ]' : '';
                output += `  - Rol: "${r.name}" | ID: ${r.id}${staffMark}\n`;
            });
            output += `\n`;
        });

        fs.writeFileSync(path.join(__dirname, 'sunucular_listesi.txt'), output, 'utf8');
        console.log(`[BİLGİ] Yan hesabın bulunduğu tüm sunucular ve rolleri "sunucular_listesi.txt" dosyasına yazıldı!`);
    } catch (err: any) {
        console.error('[HATA] sunucular_listesi.txt oluşturulamadı:', err.message);
    }
}

function getTrackTargets(): TargetConfig[] {
    const list: TargetConfig[] = [];
    const trackAll: boolean = config.options?.trackAllGuilds === true;
    const autoDetectGlobal: boolean = config.options?.autoDetectStaffRoles === true;

    if (trackAll) {
        client.guilds.cache.forEach((guild: Guild) => {
            const specificTarget = (config.targets || []).find((t: TargetConfig) => t.guildId === guild.id);
            if (specificTarget && specificTarget.roleIds && specificTarget.roleIds.length > 0) {
                list.push({
                    guildId: guild.id,
                    guildName: guild.name,
                    roleIds: specificTarget.roleIds.filter((id: string) => !id.includes('HEDEF_'))
                });
            } else {
                const staffRoleIds: string[] = guild.roles.cache.filter((r: Role) => isStaffRole(r)).map((r: Role) => r.id);
                list.push({
                    guildId: guild.id,
                    guildName: guild.name,
                    roleIds: staffRoleIds
                });
            }
        });
    } else {
        for (const target of (config.targets || [])) {
            if (!target.guildId || target.guildId.includes('HEDEF_')) continue;

            const guild: Guild | undefined = client.guilds.cache.get(target.guildId);
            if (!guild) {
                list.push(target);
                continue;
            }

            let roleIds: string[] = (target.roleIds || []).filter((id: string) => !id.includes('HEDEF_'));

            if (roleIds.length === 0 && (target.autoDetectStaff || autoDetectGlobal)) {
                roleIds = guild.roles.cache.filter((r: Role) => isStaffRole(r)).map((r: Role) => r.id);
            }

            list.push({
                guildId: target.guildId,
                guildName: target.guildName || guild.name,
                roleIds: roleIds
            });
        }
    }

    return list;
}

async function syncTrackedRoles(isInitial: boolean = false): Promise<void> {
    const targets: TargetConfig[] = getTrackTargets();
    if (targets.length === 0) {
        if (isInitial) {
            console.warn('[UYARI] Takip edilecek hedef sunucu bulunamadı!');
        }
        return;
    }

    for (const target of targets) {
        const guild: Guild | undefined = client.guilds.cache.get(target.guildId);
        if (!guild) {
            if (isInitial) {
                console.warn(`[UYARI] Hedef sunucu bulunamadı: ${target.guildId}`);
            }
            continue;
        }

        if (!roleCache[guild.id]) roleCache[guild.id] = {};

        if (guild.memberCount && guild.memberCount < 10000) {
            try {
                await guild.members.fetch();
            } catch (_) {}
        }

        for (const roleId of (target.roleIds || [])) {
            const role: Role | undefined = guild.roles.cache.get(roleId);
            if (!role) {
                if (isInitial) {
                    console.warn(`[UYARI] Hedef rol bulunamadı: ${roleId} (Sunucu: ${guild.name})`);
                }
                continue;
            }

            const currentMembers = role.members;
            const currentIds: Set<string> = new Set<string>(currentMembers.map((m: GuildMember) => m.id));

            if (!roleCache[guild.id][roleId]) {
                roleCache[guild.id][roleId] = currentIds;
                if (isInitial) {
                    console.log(`[TAKİBE ALINDI] "${guild.name}" > "${role.name}" (${currentIds.size} yetkili üye izleniyor)`);
                }
            } else {
                const prevIds: Set<string> = roleCache[guild.id][roleId];

                for (const oldUserId of prevIds) {
                    if (!currentIds.has(oldUserId)) {
                        const user: any = client.users.cache.get(oldUserId) || { id: oldUserId, tag: oldUserId, username: oldUserId };
                        const stillInGuild: boolean = guild.members.cache.has(oldUserId);

                        await sendAlert({
                            user,
                            role,
                            guild,
                            type: stillInGuild ? AlertType.RoleRemoved : AlertType.LeftServer
                        });
                    }
                }

                roleCache[guild.id][roleId] = currentIds;
            }
        }
    }

    saveCache();
}

const myIntents: Intents = new Intents();
myIntents.add(
    Intents.FLAGS.GUILDS,
    'GUILD_MEMBER',
    Intents.FLAGS.GUILD_MESSAGES
);

const client: Client = new Client({
    checkUpdate: false,
    intents: myIntents
});

client.on('ready', async (): Promise<void> => {
    console.log('===============================================================');
    console.log(`[STAFF TRACKER] Giriş Başarılı: ${client.user?.tag} (${client.user?.id})`);
    console.log(`[STAFF TRACKER] Sunucu Sayısı: ${client.guilds.cache.size}`);
    console.log('===============================================================');

    if (config.options?.saveServerListOnStartup !== false) {
        exportServersAndRoles();
    }

    await syncTrackedRoles(true);

    const intervalSec: number = Math.max(10, config.checkIntervalSeconds || 30);
    setInterval(async () => {
        await syncTrackedRoles(false);
    }, intervalSec * 1000);
});

client.on('guildMemberUpadte', async (oldMember: GuildMember, newMember: GuildMember): Promise<void> => {
    const targets: TargetConfig[] = getTrackTargets();
    const target = targets.find((t: TargetConfig) => t.guildId === newMember.guild.id);
    if (!target) return;

    const watchedRoleIds: Set<string> = new Set<string>(target.roleIds || []);
    const removedRoles = oldMember.roles.cache.filter((r: Role) => watchedRoleIds.has(r.id) && !newMember.roles.cache.has(r.id));

    for (const [roleId, role] of removedRoles) {
        if (roleCache[newMember.guild.id]?.[roleId]?.has(newMember.id)) {
            roleCache[newMember.guild.id][roleId].delete(newMember.id);
            saveCache();
        }

        await sendAlert({
            user: newMember.user,
            role,
            guild: newMember.guild,
            type: AlertType.RoleRemoved
        });
    }

    const addedRoles = newMember.roles.cache.filter((r: Role) => watchedRoleIds.has(r.id) && !oldMember.roles.cache.has(r.id));
    for (const [roleId] of addedRoles) {
        if (!roleCache[newMember.guild.id]) roleCache[newMember.guild.id] = {};
        if (!roleCache[newMember.guild.id][roleId]) roleCache[newMember.guild.id][roleId] = new Set<string>();
        roleCache[newMember.guild.id][roleId].add(newMember.id);
        saveCache();
    }
});

client.on('guildMemberRemove', async (member: GuildMember): Promise<void> => {
    const targets: TargetConfig[] = getTrackTargets();
    const target = targets.find((t: TargetConfig) => t.guildId === member.guild.id);
    if (!target) return;

    const watchedRoleIds: Set<string> = new Set<string>(target.roleIds || []);

    for (const roleId of watchedRoleIds) {
        const wasInCache: boolean | undefined = roleCache[member.guild.id]?.[roleId]?.has(member.id);
        const hadRole: boolean = member.roles?.cache ? (member as any).role.cache.has(roleId) : false;

        if (wasInCache || hadRole) {
            const role = member.guild.roles.cache.get(roleId) || { id: roleId, name: 'Takip Edilen Yetki' };
            if (roleCache[member.guild.id]?.[roleId]) {
                roleCache[member.guild.id][roleId].delete(member.id);
                saveCache();
            }

            await sendAlert({
                user: member.user || { id: member.id, tag: member.id, username: member.id },
                role: role as Role,
                guild: member.guild,
                type: AlertType.LeftServer
            });
        }
    }
});

client.on('error', (err: Error): void => {
    console.error('[CLIENT HATASI]', err.message);
});

process.on('unhandledRejection', (reason: unknown): void => {
    console.error('[BEKLENMEYEN HATA]', reason);
});

if (config.token && !config.token.includes('BURAYA_')) {
    console.log('[BİLGİ] Yan hesaba giriş yapılıyor...');
    client.login(config.token).catch((err: Error) => {
        console.error('[HATA] Token ile giriş başarısız:', err.message);
    });
} else {
    console.log('===============================================================');
    console.log('[BİLGİ] config.json dosyasına yan hesabınızın tokenini yazın!');
    console.log('===============================================================');
}
