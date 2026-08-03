import unittest

from services.production_config import production_configuration_errors


def valid_environment():
    return {
        "APP_ENV": "production",
        "APP_VERSION": "release-2026-08-03",
        "DATABASE_URL": "postgresql://app:secret@db.internal/app?sslmode=require",
        "SECRET_KEY": "s" * 40,
        "RATE_LIMIT_HASH_KEY": "r" * 40,
        "APPLICATIONINSIGHTS_CONNECTION_STRING": "InstrumentationKey=abc",
        "FRONTEND_URL": "https://app.xceed.live",
        "CORS_ORIGINS": "https://app.xceed.live",
        "PAYPAL_MODE": "live",
        "PAYPAL_CLIENT_ID": "Acbd-production-client",
        "PAYPAL_CLIENT_SECRET": "production-paypal-secret",
        "PAYPAL_WEBHOOK_ID": "9AB-production-webhook",
        "PAYPAL_STARTER_PLAN_ID": "P-STARTER",
        "PAYPAL_PRO_PLAN_ID": "P-PRO",
        "PAYPAL_ELITE_PLAN_ID": "P-ELITE",
        "TAPE_STORAGE_MODE": "azure",
        "TAPE_STORAGE_ACCOUNT_URL": "https://xmartial.blob.core.windows.net",
        "TAPE_STORAGE_CONTAINER": "practice-tapes",
        "EMAIL_PROVIDER": "azure",
        "AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING": "endpoint=https://mail.communication.azure.com/;accesskey=abc",
        "AZURE_EMAIL_SENDER": "security@xceed.live",
    }


class ProductionConfigTests(unittest.TestCase):
    def test_complete_production_environment_passes(self):
        self.assertEqual(production_configuration_errors(valid_environment()), [])

    def test_development_environment_is_not_subject_to_production_contract(self):
        self.assertEqual(production_configuration_errors({"APP_ENV": "development"}), [])

    def test_localhost_frontend_and_missing_ssl_are_rejected(self):
        env = valid_environment()
        env["FRONTEND_URL"] = "http://localhost:5173"
        env["CORS_ORIGINS"] = "*"
        env["DATABASE_URL"] = "postgresql://app:secret@db.internal/app"
        errors = "\n".join(production_configuration_errors(env))
        self.assertIn("FRONTEND_URL", errors)
        self.assertIn("CORS_ORIGINS", errors)
        self.assertIn("sslmode=require", errors)

    def test_placeholders_reused_secrets_and_sandbox_billing_are_rejected(self):
        env = valid_environment()
        env["PAYPAL_CLIENT_ID"] = "your_live_paypal_client_id"
        env["PAYPAL_MODE"] = "sandbox"
        env["RATE_LIMIT_HASH_KEY"] = env["SECRET_KEY"]
        errors = "\n".join(production_configuration_errors(env))
        self.assertIn("PAYPAL_CLIENT_ID", errors)
        self.assertIn("PAYPAL_MODE", errors)
        self.assertIn("must be different", errors)


if __name__ == "__main__":
    unittest.main()
