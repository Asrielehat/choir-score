"use client";

import * as Dropdown from "@radix-ui/react-dropdown-menu";
import * as React from "react";
import { cn } from "@/lib/utils";

export const DropdownMenu = Dropdown.Root;
export const DropdownMenuTrigger = Dropdown.Trigger;

export function DropdownMenuContent({ className, ...props }: React.ComponentProps<typeof Dropdown.Content>) {
  return (
    <Dropdown.Portal>
      <Dropdown.Content
        sideOffset={6}
        className={cn(
          "z-50 min-w-48 rounded-lg border border-[#343846] bg-[#1c212c] p-1 text-sm text-[#f3efe6] shadow-xl",
          className,
        )}
        {...props}
      />
    </Dropdown.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof Dropdown.Item>) {
  return (
    <Dropdown.Item
      className={cn(
        "cursor-pointer rounded-md px-2.5 py-2 outline-none select-none data-[highlighted]:bg-white/10",
        className,
      )}
      {...props}
    />
  );
}
