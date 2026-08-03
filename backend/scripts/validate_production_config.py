"""Validate the current process environment without starting the application."""
from services.production_config import validate_runtime_environment


if __name__ == "__main__":
    validate_runtime_environment()
    print("Production environment configuration is valid.")
