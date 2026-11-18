"use client";

import * as SliderPrimitive from "@radix-ui/react-slider";
import * as React from "react";
import { cn } from "@/lib/utils";

export function Slider({ className, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      className={cn("relative flex w-full touch-none items-center select-none", className)}
      {...props}
    >
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-[#2c3142]">
        <SliderPrimitive.Range className="absolute h-full bg-[#d7a15e]" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block h-3.5 w-3.5 rounded-full border border-[#1a1208] bg-[#f3efe6] shadow focus-visible:ring-2 focus-visible:ring-[#d7a15e] focus-visible:outline-none" />
    </SliderPrimitive.Root>
  );
}
