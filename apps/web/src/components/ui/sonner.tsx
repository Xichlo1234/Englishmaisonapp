import { Toaster as Sonner, type ToasterProps } from 'sonner';

function Toaster(props: ToasterProps) {
  return <Sonner position="bottom-right" richColors closeButton duration={3500} {...props} />;
}

export { Toaster };
