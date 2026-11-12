import { Toaster as Sonner, type ToasterProps } from 'sonner';

function Toaster(props: ToasterProps) {
  return <Sonner position="top-right" offset={64} mobileOffset={{ top: 64 }} richColors closeButton duration={3500} {...props} />;
}

export { Toaster };
