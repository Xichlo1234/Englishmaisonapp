import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { KeyRound, LogOut, Menu, UserCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useAuth } from '@/hooks/use-auth';
import { usePublicSettings } from '@/hooks/use-settings';
import { cn } from '@/lib/utils';
import { APP_ICON, NAV_ITEMS } from './nav';

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useAuth();
  const items = NAV_ITEMS.filter((i) => i.ready && can(i.permission));
  return (
    <nav className="flex flex-col gap-0.5 px-3" aria-label="Điều hướng chính">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-white hover:text-foreground',
              isActive && 'bg-white text-primary shadow-xs ring-1 ring-border',
            )
          }
        >
          <item.icon className="size-4.5" />
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

function Brand() {
  const settings = usePublicSettings();
  const Icon = APP_ICON;
  return (
    <Link to="/" className="flex items-center gap-2.5 px-6 py-5">
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-white">
        <Icon className="size-5" />
      </span>
      <span className="text-sm font-semibold leading-tight">{settings.data?.center_name ?? 'Quản lý lớp học'}</span>
    </Link>
  );
}

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r bg-sidebar md:flex">
        <Brand />
        <SidebarNav />
      </aside>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="left-0 right-auto max-w-64 border-r bg-sidebar p-0">
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <Brand />
          <SidebarNav onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur md:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)} aria-label="Mở menu">
            <Menu />
          </Button>
          <div className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2">
                <UserCircle2 className="size-5 text-muted-foreground" />
                <span className="max-w-40 truncate">{user?.fullName}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                <div className="font-medium">{user?.fullName}</div>
                <div className="text-xs font-normal text-muted-foreground">{user?.roleName}</div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate('/tai-khoan')}>
                <KeyRound /> Tài khoản & mật khẩu
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={async () => {
                  await logout();
                  navigate('/dang-nhap', { replace: true });
                }}
              >
                <LogOut /> Đăng xuất
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main className="flex-1 px-4 py-6 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
