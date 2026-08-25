'use client'

import { useState } from 'react'
import { AlertTriangle, Check, CheckCheck, Clock, Loader2, RefreshCw, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { Message } from '@/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

const STATUS_LABEL: Record<Message['status'], string> = {
  pending: 'Pendente', queued: 'Na fila', sending: 'Enviando', sent: 'Enviada ao provedor',
  delivered: 'Entregue', read: 'Lida', replied: 'Respondida', failed: 'Falhou', cancelled: 'Cancelada',
}

function StatusGlyph({ status }: { status: Message['status'] }) {
  if (status === 'pending' || status === 'queued' || status === 'sending') return <Clock className="h-3 w-3" />
  if (status === 'sent') return <Check className="h-3 w-3" />
  if (status === 'delivered' || status === 'read' || status === 'replied') return <CheckCheck className="h-3 w-3" />
  return <XCircle className="h-3 w-3" />
}

interface DeliveryData {
  message: Message
  events: Array<{ id: string; to_status: Message['status']; occurred_at: string }>
  attempts: Array<{
    id: string
    attempt_number: number
    status: string
    error_message?: string
    is_retryable: boolean
    started_at: string
    finished_at?: string
  }>
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('pt-BR') : '—'
}

function providerLabel(provider?: string) {
  if (provider === 'whatsapp_personal') return 'WhatsApp conectado por QR Code'
  if (provider === 'meta_cloud_api') return 'WhatsApp Business Cloud'
  return provider || 'WhatsApp'
}

export function MessageDeliveryDetails({ message }: { message: Message }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<DeliveryData | null>(null)
  const [loading, setLoading] = useState(false)
  const [retrying, setRetrying] = useState(false)

  async function load() {
    setLoading(true)
    const response = await fetch(`/api/whatsapp/messages/${message.id}/delivery`)
    const body = await response.json().catch(() => null)
    setLoading(false)
    if (!response.ok) { toast.error(body?.error ?? 'Não foi possível carregar os detalhes.'); return }
    setData(body)
  }

  async function retry() {
    setRetrying(true)
    const response = await fetch(`/api/whatsapp/messages/${message.id}/delivery`, { method: 'POST' })
    const body = await response.json().catch(() => null)
    setRetrying(false)
    if (!response.ok) { toast.error(body?.error ?? 'Não foi possível tentar novamente.'); return }
    toast.success('Nova tentativa enviada ao provedor.')
    setOpen(false)
  }

  const current = data?.message ?? message
  return <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next && !data) void load() }}>
    <DialogTrigger render={<button type="button" className="inline-flex items-center" title={`Status: ${STATUS_LABEL[message.status]}`} />}><StatusGlyph status={message.status} /></DialogTrigger>
    <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Status da mensagem</DialogTitle><DialogDescription>Acompanhe o que aconteceu depois que você clicou em enviar.</DialogDescription></DialogHeader>
      {loading ? <div className="flex justify-center py-10"><Loader2 className="animate-spin text-muted-foreground" /></div> : <div className="space-y-5">
        <div className={`rounded-xl border p-4 ${current.status === 'failed' ? 'border-destructive/30 bg-destructive/5' : 'bg-muted/30'}`}><div className="flex items-center gap-2 font-semibold">{current.status === 'failed' ? <AlertTriangle className="text-destructive" /> : <StatusGlyph status={current.status} />}{STATUS_LABEL[current.status]}</div>{current.status === 'sent' && <p className="mt-2 text-sm text-muted-foreground">O WhatsApp aceitou a mensagem, mas ainda não confirmou a entrega ao destinatário.</p>}{current.error_message && <p className="mt-2 text-sm text-destructive">{current.error_message}</p>}</div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border p-4 text-sm">
          <div><dt className="text-xs text-muted-foreground">Criada em</dt><dd className="mt-0.5 font-medium">{formatDate(current.created_at)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Enviada ao provedor</dt><dd className="mt-0.5 font-medium">{formatDate(current.sent_at)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Entregue em</dt><dd className="mt-0.5 font-medium">{formatDate(current.delivered_at)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Lida em</dt><dd className="mt-0.5 font-medium">{formatDate(current.read_at)}</dd></div>
          <div className="col-span-2"><dt className="text-xs text-muted-foreground">Canal</dt><dd className="mt-0.5 font-medium">{providerLabel(current.provider)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Tentativas</dt><dd className="mt-0.5 font-medium">{data?.attempts.length || current.attempt_count || 1}</dd></div>
          <div><dt className="text-xs text-muted-foreground">ID da mensagem</dt><dd className="mt-0.5 truncate font-mono text-xs" title={current.message_id}>{current.message_id || '—'}</dd></div>
        </dl>
        <div><h3 className="mb-3 text-sm font-semibold">Histórico</h3><div className="space-y-3">{(data?.events ?? []).map((event) => <div key={event.id} className="flex items-center justify-between gap-3 text-sm"><span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-primary" />{STATUS_LABEL[event.to_status]}</span><time className="text-xs text-muted-foreground">{formatDate(event.occurred_at)}</time></div>)}{data?.events.length === 0 && <p className="text-sm text-muted-foreground">O histórico começará na próxima atualização de status.</p>}</div></div>
        {current.status === 'failed' && <Button className="w-full" onClick={retry} disabled={retrying}>{retrying ? <Loader2 className="animate-spin" /> : <RefreshCw />}Tentar novamente</Button>}
      </div>}
    </DialogContent>
  </Dialog>
}
