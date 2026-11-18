import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-md border border-[#343846] bg-[#12151d] px-2.5 text-sm text-[#f3efe6] outline-none placeholder:text-[#7e7a72] focus:ring-2 focus:ring-[#d7a15e]/60",
        className,
      )}
      {...props}
    />
  );
}
