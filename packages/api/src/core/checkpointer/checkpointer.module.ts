import { Global, Module } from "@nestjs/common";
import { CheckpointerProvider } from "./checkpointer.provider.js";

@Global()
@Module({
	providers: [CheckpointerProvider],
	exports: [CheckpointerProvider],
})
export class CheckpointerModule {}
