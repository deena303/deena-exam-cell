import React, { useEffect, useState } from 'react';
import { BellRing, Check, RefreshCw, Inbox, Clock } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { fetchNotifications, markNotificationsRead } from '../../services/authApi';
import { PaperRequestNotification } from '../../types';

const TYPE_STYLES: Record<string, { label: string; cls: string }> = {
  submitted: { label: 'New Request', cls: 'bg-amber-100 text-amber-800' },
  approved: { label: 'Approved', cls: 'bg-emerald-100 text-emerald-800' },
  partially_approved: { label: 'Partial Approval', cls: 'bg-blue-100 text-blue-800' },
  rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-800' },
  generated: { label: 'Paper Generated', cls: 'bg-emerald-100 text-emerald-800' }
};

/**
 * Principal Portal — Notifications (Spec §8)
 *
 * Shows approval workflow events for the signed-in user. Backed by the
 * `paper_request_notifications` table; marking read is a server call.
 */
export const PrincipalNotificationsView: React.FC = () => {
  const { authSession } = useApp();
  const [items, setItems] = useState<PaperRequestNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const token = authSession?.token || '';

  const load = () => {
    setLoading(true);
    fetchNotifications(token)
      .then(rows => {
        setItems(rows as PaperRequestNotification[]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(load, [authSession]);

  const unread = items.filter(i => !i.is_read).length;

  const handleMarkAllRead = async () => {
    await markNotificationsRead(token);
    load();
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E5E7EB] pb-6">
        <div>
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-emerald-700">Principal Portal</span>
          <h1 className="mt-1 text-2xl sm:text-3xl font-black tracking-tight text-[#111827]">Notifications</h1>
          <p className="mt-1 text-xs text-[#64748B]">
            Additional paper request activity and Principal approval decisions.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {unread > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-xl bg-[#FFF0F3] px-3 py-2 text-[11px] font-extrabold text-[#D71945]">
              <BellRing className="h-3.5 w-3.5" /> {unread} Unread
            </span>
          )}
          <button
            onClick={handleMarkAllRead}
            disabled={unread === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-4 py-2.5 text-xs font-bold text-[#111827] hover:bg-[#F7F8FA] disabled:opacity-50 disabled:cursor-not-allowed transition-all cursor-pointer"
          >
            <Check className="h-4 w-4 text-emerald-700" />
            <span>Mark All Read</span>
          </button>
          <button
            onClick={load}
            className="inline-flex items-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-xs font-bold text-[#64748B] hover:bg-[#F7F8FA] transition-all cursor-pointer"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-2xl bg-[#F1F5F9] animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-3xl border border-[#E5E7EB] bg-white p-12 text-center">
          <Inbox className="h-10 w-10 text-[#94A3B8] mx-auto mb-3" />
          <p className="text-sm font-bold text-[#64748B]">No notifications.</p>
          <p className="text-xs text-[#94A3B8] mt-1">Approval workflow activity will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((n) => {
            const style = TYPE_STYLES[n.notification_type] || TYPE_STYLES.submitted;
            return (
              <div
                key={n.id}
                className={`rounded-2xl border bg-white p-4 flex items-start gap-3 transition-colors ${
                  n.is_read ? 'border-[#E5E7EB]' : 'border-emerald-200 bg-emerald-50/30'
                }`}
              >
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${style.cls.split(' ')[0]}`}>
                  <BellRing className={`h-4 w-4 ${style.cls.split(' ')[1]}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold ${style.cls}`}>{style.label}</span>
                    {!n.is_read && <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />}
                  </div>
                  <p className="mt-1 text-xs text-[#111827] leading-relaxed">{n.message}</p>
                  <p className="mt-1 inline-flex items-center gap-1 text-[10px] text-[#94A3B8]">
                    <Clock className="h-3 w-3" />
                    {new Date(n.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
