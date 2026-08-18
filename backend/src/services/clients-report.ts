import { getDb } from './db';

export interface ClientBusiness {
  id: number;
  name: string;
  slug: string;
  createdAt: string;
  ownerChatId: string;
  telegramUsername: string | null;
  phone: string | null;
  adminEmail: string | null;
  agreementAcceptedAt: string | null;
  bookingRequestsEnabled: boolean;
  workingHours: string | null;
  contactLinks: { type: string; url: string }[];
  slotsTotal: number;
  slotsBooked: number;
  slotsFuture: number;
  firstSlotDate: string | null;
  lastSlotDate: string | null;
  requestsTotal: number;
  requestsPending: number;
  botMsgCount: number;
  lastBotMsgAt: string | null;
  /** Опубликовал ли хотя бы один слот — ключевая метрика активации. */
  activated: boolean;
}

export interface OrphanAdmin {
  email: string;
  createdAt: string;
  linkedToTelegram: boolean;
}

export interface RecentRequest {
  businessName: string;
  businessSlug: string;
  clientName: string;
  clientPhone: string;
  description: string | null;
  preferredDate: string;
  preferredTime: string;
  status: string;
  createdAt: string;
}

export interface ClientsReport {
  generatedAt: string;
  totals: {
    businesses: number;
    activated: number;
    withBookings: number;
    adminUsers: number;
    orphanAdmins: number;
    bookingRequests: number;
  };
  businesses: ClientBusiness[];
  orphanAdmins: OrphanAdmin[];
  recentRequests: RecentRequest[];
}

/**
 * Полная сводка по зарегистрированным клиентам: кто завёл бизнес, дошёл ли до
 * публикации расписания, есть ли брони и заявки. Отдаётся только со страницы
 * /admin/clients под паролем — здесь персональные данные владельцев.
 */
export function getClientsReport(): ClientsReport {
  const db = getDb();

  const businessRows = db.prepare(`
    SELECT
      b.id,
      b.name,
      b.slug,
      b.created_at                          AS createdAt,
      b.owner_chat_id                       AS ownerChatId,
      b.telegram_username                   AS telegramUsername,
      COALESCE(b.owner_phone, oa.phone)     AS phone,
      au.email                              AS adminEmail,
      oa.accepted_at                        AS agreementAcceptedAt,
      b.booking_requests_enabled            AS bookingRequestsEnabled,
      b.working_hours                       AS workingHours,
      COALESCE(mc.msg_count, 0)             AS botMsgCount,
      mc.last_msg_at                        AS lastBotMsgAt,
      (SELECT COUNT(*) FROM slots s
         WHERE s.business_id = b.id)                              AS slotsTotal,
      (SELECT COUNT(*) FROM slots s
         WHERE s.business_id = b.id AND s.status = 'booked')      AS slotsBooked,
      (SELECT COUNT(*) FROM slots s
         WHERE s.business_id = b.id AND s.date_key >= date('now'))AS slotsFuture,
      (SELECT MIN(s.date_key) FROM slots s
         WHERE s.business_id = b.id)                              AS firstSlotDate,
      (SELECT MAX(s.date_key) FROM slots s
         WHERE s.business_id = b.id)                              AS lastSlotDate,
      (SELECT COUNT(*) FROM booking_requests r
         WHERE r.business_id = b.id)                              AS requestsTotal,
      (SELECT COUNT(*) FROM booking_requests r
         WHERE r.business_id = b.id AND r.status = 'pending')      AS requestsPending
    FROM businesses b
    LEFT JOIN owner_agreements   oa ON oa.owner_chat_id = b.owner_chat_id
    LEFT JOIN admin_users        au ON au.owner_chat_id = b.owner_chat_id
    LEFT JOIN bot_message_counts mc ON mc.chat_id       = b.owner_chat_id
    ORDER BY b.created_at DESC
  `).all() as any[];

  const linkStmt = db.prepare('SELECT type, url FROM contact_links WHERE business_id = ? ORDER BY type');

  const businesses: ClientBusiness[] = businessRows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    createdAt: r.createdAt,
    ownerChatId: r.ownerChatId,
    telegramUsername: r.telegramUsername ?? null,
    phone: r.phone ?? null,
    adminEmail: r.adminEmail ?? null,
    agreementAcceptedAt: r.agreementAcceptedAt ?? null,
    bookingRequestsEnabled: !!r.bookingRequestsEnabled,
    workingHours: r.workingHours ?? null,
    contactLinks: linkStmt.all(r.id) as { type: string; url: string }[],
    slotsTotal: r.slotsTotal ?? 0,
    slotsBooked: r.slotsBooked ?? 0,
    slotsFuture: r.slotsFuture ?? 0,
    firstSlotDate: r.firstSlotDate ?? null,
    lastSlotDate: r.lastSlotDate ?? null,
    requestsTotal: r.requestsTotal ?? 0,
    requestsPending: r.requestsPending ?? 0,
    botMsgCount: r.botMsgCount ?? 0,
    lastBotMsgAt: r.lastBotMsgAt ?? null,
    activated: (r.slotsTotal ?? 0) > 0,
  }));

  // Зарегистрировались в админке, но бизнеса за ними нет — то есть отвалились
  // сразу после регистрации.
  const orphanRows = db.prepare(`
    SELECT au.email, au.created_at AS createdAt, au.owner_chat_id AS ownerChatId
    FROM admin_users au
    WHERE au.owner_chat_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM businesses b WHERE b.owner_chat_id = au.owner_chat_id)
    ORDER BY au.created_at DESC
  `).all() as any[];

  const orphanAdmins: OrphanAdmin[] = orphanRows.map((r) => ({
    email: r.email,
    createdAt: r.createdAt,
    linkedToTelegram: !!r.ownerChatId,
  }));

  const recentRequests = db.prepare(`
    SELECT
      b.name              AS businessName,
      b.slug              AS businessSlug,
      r.client_name       AS clientName,
      r.client_phone      AS clientPhone,
      r.description       AS description,
      r.preferred_date    AS preferredDate,
      r.preferred_time    AS preferredTime,
      r.status            AS status,
      r.created_at        AS createdAt
    FROM booking_requests r
    JOIN businesses b ON b.id = r.business_id
    ORDER BY r.created_at DESC
    LIMIT 50
  `).all() as RecentRequest[];

  const adminCount = (db.prepare('SELECT COUNT(*) AS cnt FROM admin_users').get() as any)?.cnt ?? 0;
  const requestCount = (db.prepare('SELECT COUNT(*) AS cnt FROM booking_requests').get() as any)?.cnt ?? 0;

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      businesses: businesses.length,
      activated: businesses.filter((b) => b.activated).length,
      withBookings: businesses.filter((b) => b.slotsBooked > 0).length,
      adminUsers: adminCount,
      orphanAdmins: orphanAdmins.length,
      bookingRequests: requestCount,
    },
    businesses,
    orphanAdmins,
    recentRequests,
  };
}
