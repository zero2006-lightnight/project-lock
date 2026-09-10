import { requireUser } from "@/lib/auth/actions";
import { getOrCreateSession, chatHistoryForView, listSessions } from "@/lib/services/chat";
import { ChatView } from "@/components/app/chat-view";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const user = await requireUser();
  // Sessions: each login starts a fresh conversation; past sessions are
  // kept and listed so nothing discussed is lost.
  const activeId = await getOrCreateSession(user.id);
  const [history, sessions] = await Promise.all([
    chatHistoryForView(activeId),
    listSessions(user.id),
  ]);

  return (
    <ChatView
      userName={user.name}
      activeConversationId={activeId}
      initialMessages={history.map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        meta: m.meta as MsgMeta,
      }))}
      sessions={sessions.map((s) => ({
        id: s.id,
        title: s.title,
        preview: s.preview,
        updatedAt: s.updatedAt,
        messageCount: s.messageCount,
        active: s.id === activeId,
      }))}
    />
  );
}

type MsgMeta = {
  actions?: { label: string; href: string }[];
  suggested?: string[];
} | null;
