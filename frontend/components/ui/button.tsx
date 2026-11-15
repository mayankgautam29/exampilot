import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border-[1.5px] border-transparent text-sm font-semibold whitespace-nowrap transition-[transform,box-shadow,background-color,color] duration-100 outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-edge bg-primary text-primary-foreground shadow-[2px_2px_0_var(--hard)] hover:-translate-x-px hover:-translate-y-px hover:shadow-[3px_3px_0_var(--hard)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",
        brand:
          "border-edge bg-brand text-brand-foreground shadow-[2px_2px_0_var(--hard)] hover:-translate-x-px hover:-translate-y-px hover:shadow-[3px_3px_0_var(--hard)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",
        outline:
          "border-edge bg-card text-foreground shadow-[2px_2px_0_var(--hard)] hover:-translate-x-px hover:-translate-y-px hover:bg-accent hover:shadow-[3px_3px_0_var(--hard)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none aria-expanded:bg-accent",
        secondary:
          "border-edge bg-marker text-ink shadow-[2px_2px_0_var(--hard)] hover:-translate-x-px hover:-translate-y-px hover:shadow-[3px_3px_0_var(--hard)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",
        ghost: "font-medium hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent",
        destructive:
          "border-bad bg-bad/10 text-bad shadow-[2px_2px_0_var(--bad)] hover:-translate-x-px hover:-translate-y-px hover:bg-bad/15 hover:shadow-[3px_3px_0_var(--bad)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none",
        link: "font-medium text-brand underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 gap-1.5 px-3.5 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 rounded px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 rounded px-3 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 px-4 text-[0.95rem] has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-9",
        "icon-xs": "size-6 rounded [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
