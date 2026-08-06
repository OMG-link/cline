import { ArrowDownIcon } from "lucide-react"
import { memo } from "react"
import { Button } from "@/components/ui/button"

interface ScrollToBottomButtonProps {
	onClick: () => void
}

export const ScrollToBottomButton = memo(function ScrollToBottomButton({ onClick }: ScrollToBottomButtonProps) {
	return (
		<Button
			aria-label="Scroll to bottom"
			className="absolute bottom-3 right-3.5 z-10 flex rounded-full p-2 shadow-md backdrop-blur-sm [&_svg]:size-4"
			onClick={onClick}
			size="icon"
			type="button"
			variant="default">
			<ArrowDownIcon />
		</Button>
	)
})
