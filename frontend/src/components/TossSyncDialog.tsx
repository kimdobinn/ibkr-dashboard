import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface TossSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSync: (name: string, birthday: string, phone: string) => Promise<void>;
  savedCredentials?: {
    toss_name: string | null;
    toss_birthday: string | null;
    toss_phone: string | null;
  };
  onSaveCredentials?: (name: string, birthday: string, phone: string) => void;
  onClearCredentials?: () => void;
}

async function isBackendRunning(): Promise<boolean> {
  try {
    const resp = await fetch("http://localhost:8000/api/ibkr/status", {
      signal: AbortSignal.timeout(2000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export function TossSyncDialog({
  open,
  onOpenChange,
  onSync,
  savedCredentials,
  onSaveCredentials,
  onClearCredentials,
}: TossSyncDialogProps) {
  const [name, setName] = useState("");
  const [birthday, setBirthday] = useState("");
  const [phone, setPhone] = useState("");
  const [remember, setRemember] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backendUp, setBackendUp] = useState<boolean | null>(null);

  useEffect(() => {
    if (open) {
      setBackendUp(null);
      isBackendRunning().then(setBackendUp);

      if (savedCredentials?.toss_name) {
        setName(savedCredentials.toss_name);
        setBirthday(savedCredentials.toss_birthday ?? "");
        setPhone(savedCredentials.toss_phone ?? "");
        setRemember(true);
      }
    }
  }, [open, savedCredentials]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !birthday || !phone) return;
    setSyncing(true);
    setError(null);
    try {
      if (remember) {
        onSaveCredentials?.(name, birthday, phone);
      } else {
        onClearCredentials?.();
      }
      await onSync(name, birthday, phone);
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Sync failed. Please try again."
      );
    } finally {
      setSyncing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sync from Toss Securities</DialogTitle>
        </DialogHeader>

        {backendUp === false ? (
          <div className="space-y-4">
            <div className="text-sm text-amber-500 bg-amber-500/10 rounded-lg p-4 space-y-2">
              <p className="font-medium">Local server is not running</p>
              <p className="text-muted-foreground">
                Toss sync requires the local backend. Start it with:
              </p>
              <pre className="bg-background rounded-md p-2 text-xs font-mono mt-2 overflow-x-auto whitespace-pre-wrap break-all">
                cd ~/Documents/Projects/IBKR\ Dashboard/backend && source .venv/bin/activate && uvicorn main:app --reload --port 8000
              </pre>
            </div>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setBackendUp(null);
                isBackendRunning().then(setBackendUp);
              }}
            >
              Retry connection
            </Button>
          </div>
        ) : backendUp === null ? (
          <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
            Checking local server...
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="toss-name">Name (이름)</Label>
              <Input
                id="toss-name"
                placeholder="홍길동"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={syncing}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="toss-birthday">Birthday (생년월일 6자리)</Label>
              <Input
                id="toss-birthday"
                placeholder="020304"
                maxLength={6}
                value={birthday}
                onChange={(e) =>
                  setBirthday(e.target.value.replace(/\D/g, ""))
                }
                disabled={syncing}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="toss-phone">Phone (휴대폰 번호)</Label>
              <Input
                id="toss-phone"
                placeholder="01012345678"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                disabled={syncing}
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                disabled={syncing}
                className="rounded border-border"
              />
              Remember my info
            </label>
            {error && (
              <div className="text-sm text-red-500 bg-red-500/10 rounded-lg p-3">
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={syncing}>
              {syncing ? "Approve on your Toss app..." : "Sync from Toss"}
            </Button>
            {syncing && (
              <p className="text-sm text-muted-foreground text-center">
                Check your phone for the Toss notification
              </p>
            )}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
