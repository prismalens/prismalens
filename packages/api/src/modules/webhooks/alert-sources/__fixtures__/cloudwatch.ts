// https://docs.aws.amazon.com/sns/latest/dg/sns-message-and-json-formats.html
// https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html
const envelope = {
	MessageId: "c9b5c6f2-3a0f-5a53-a6a2-3d36d0f0b8f4",
	TopicArn: "arn:aws:sns:us-east-1:123456789012:prod-alarms",
	Timestamp: "2026-09-19T10:00:00.000Z",
	SignatureVersion: "1",
	Signature: "EXAMPLE",
	SigningCertURL:
		"https://sns.us-east-1.amazonaws.com/SimpleNotificationService-0000000000000000000000.pem",
};

export const subscriptionConfirmation = {
	...envelope,
	Type: "SubscriptionConfirmation",
	Token: "2336412f37fb687f5d51e6e2425f004aed7a",
	Message:
		"You have chosen to subscribe to the topic arn:aws:sns:us-east-1:123456789012:prod-alarms.\nTo confirm the subscription, visit the SubscribeURL included in this message.",
	SubscribeURL:
		"https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&TopicArn=arn:aws:sns:us-east-1:123456789012:prod-alarms&Token=2336412f37fb687f5d51e6e2425f004aed7a",
};

const alarm = (state: "ALARM" | "OK") => ({
	AlarmName: "checkout-5xx-rate",
	AlarmDescription: "5xx responses above 2%",
	AWSAccountId: "123456789012",
	NewStateValue: state,
	NewStateReason:
		state === "ALARM"
			? "Threshold Crossed: 1 datapoint [4.1] was greater than the threshold (2.0)."
			: "Threshold Crossed: 1 datapoint [0.3] was not greater than the threshold (2.0).",
	StateChangeTime: "2026-09-19T10:00:00.000+0000",
	Region: "US East (N. Virginia)",
	AlarmArn: "arn:aws:cloudwatch:us-east-1:123456789012:alarm:checkout-5xx-rate",
	OldStateValue: state === "ALARM" ? "OK" : "ALARM",
	Trigger: {
		MetricName: "HTTPCode_Target_5XX_Count",
		Namespace: "AWS/ApplicationELB",
		Statistic: "AVERAGE",
		Dimensions: [{ value: "checkout", name: "ServiceName" }],
		Period: 60,
		ComparisonOperator: "GreaterThanThreshold",
		Threshold: 2.0,
	},
});

export const firing = {
	...envelope,
	Type: "Notification",
	Subject: 'ALARM: "checkout-5xx-rate" in US East (N. Virginia)',
	Message: JSON.stringify(alarm("ALARM")),
};

export const resolved = {
	...envelope,
	Type: "Notification",
	Subject: 'OK: "checkout-5xx-rate" in US East (N. Virginia)',
	Message: JSON.stringify(alarm("OK")),
};
