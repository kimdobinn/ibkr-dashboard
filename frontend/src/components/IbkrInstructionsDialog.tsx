import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface IbkrInstructionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IbkrInstructionsDialog({
  open,
  onOpenChange,
}: IbkrInstructionsDialogProps) {
  const startCmd = `cd "/Users/kimdobinn/Documents/Projects/IBKR Dashboard/gateway/clientportal.gw" && bin/run.sh root/conf.yaml & cd "/Users/kimdobinn/Documents/Projects/IBKR Dashboard/backend" && source .venv/bin/activate && uvicorn main:app --reload --port 8000`;
  const killCmd = `pkill -f "run.sh root/conf.yaml" && pkill -f "ibgroup.web.core.clientportal.gw" && pkill -f "uvicorn main:app"`;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle>IBKR Sync Instructions</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 text-sm">
          {/* Step 1 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-foreground text-background text-xs font-bold shrink-0">
                1
              </span>
              <span className="font-medium">Start everything</span>
            </div>
            <div className="relative group">
              <pre className="bg-secondary/60 rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                {startCmd}
              </pre>
              <button
                onClick={() => copyToClipboard(startCmd)}
                className="absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-accent opacity-0 group-hover:opacity-100"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
              </button>
            </div>
          </div>

          {/* Step 2 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-foreground text-background text-xs font-bold shrink-0">
                2
              </span>
              <span className="font-medium">Authenticate IBKR</span>
            </div>
            <p className="text-muted-foreground pl-8">
              Open{" "}
              <a
                href="https://localhost:5000"
                target="_blank"
                rel="noopener noreferrer"
                className="text-foreground underline underline-offset-4"
              >
                https://localhost:5000
              </a>{" "}
              &rarr; login &rarr; approve on phone
            </p>
          </div>

          {/* Step 3 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-foreground text-background text-xs font-bold shrink-0">
                3
              </span>
              <span className="font-medium">Sync holdings</span>
            </div>
            <p className="text-muted-foreground pl-8">
              Come back here and click <span className="font-medium text-foreground">IBKR Sync</span> in the header
            </p>
          </div>

          {/* Step 4 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-foreground text-background text-xs font-bold shrink-0">
                4
              </span>
              <span className="font-medium">Kill everything when done</span>
            </div>
            <div className="relative group">
              <pre className="bg-secondary/60 rounded-lg p-3 text-xs overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                {killCmd}
              </pre>
              <button
                onClick={() => copyToClipboard(killCmd)}
                className="absolute top-2 right-2 text-muted-foreground hover:text-foreground transition-colors p-1.5 rounded-md hover:bg-accent opacity-0 group-hover:opacity-100"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
