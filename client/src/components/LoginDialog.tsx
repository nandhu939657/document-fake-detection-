import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";

interface LoginDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export default function LoginDialog({ open, onOpenChange, onSuccess }: LoginDialogProps) {
  const [email, setEmail] = useState("reviewer@institution.com");
  const [name, setName] = useState("Institutional Reviewer");

  const loginMutation = trpc.auth.devLogin.useMutation({
    onSuccess: () => {
      toast.success("Successfully signed in!");
      onOpenChange(false);
      onSuccess();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to sign in");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return toast.error("Please enter a valid email");
    loginMutation.mutate({ email, name });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2 text-primary">
            <ShieldCheck className="size-6" />
            <span className="font-semibold text-lg">VerityLens Sign In</span>
          </div>
          <DialogTitle>Sign in to your workspace</DialogTitle>
          <DialogDescription>
            Enter your email to sign in or create a reviewer session to run document analyses and view history.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="name">Full Name</Label>
            <Input
              id="name"
              placeholder="Dr. Sarah Chen"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Work Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="reviewer@institution.com"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" className="w-full" disabled={loginMutation.isPending}>
            {loginMutation.isPending ? "Signing in..." : "Continue to Workspace"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
