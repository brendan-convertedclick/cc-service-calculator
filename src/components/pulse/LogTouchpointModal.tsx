import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { todayISO } from '@/lib/dates'

interface Props {
  clientId: string
  clientName: string
  open: boolean
  onClose: () => void
  onSubmit: (payload: { clientId: string; type: 'meeting' | 'call' | 'email'; notes?: string; occurredAt: string }) => void
  isPending: boolean
}

export function LogTouchpointModal({ clientId, clientName, open, onClose, onSubmit, isPending }: Props) {
  const [type, setType] = useState<'meeting' | 'call' | 'email'>('meeting')
  const [notes, setNotes] = useState('')
  const [date, setDate] = useState(todayISO())

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log touchpoint — {clientName}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div>
            <Label>Type</Label>
            <Select value={type} onValueChange={v => setType(v as typeof type)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="meeting">Meeting</SelectItem>
                <SelectItem value="call">Call</SelectItem>
                <SelectItem value="email">Email</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Date</Label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            disabled={isPending}
            onClick={() => onSubmit({ clientId, type, notes: notes || undefined, occurredAt: new Date(date).toISOString() })}
          >
            {isPending ? 'Saving…' : 'Log touchpoint'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
