import { useEffect, useRef, useState } from "react";

let paypalSdkPromise;

function loadPayPalSdk(clientId) {
  if (window.paypal) {
    return Promise.resolve(window.paypal);
  }

  if (!paypalSdkPromise) {
    paypalSdkPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&vault=true&intent=subscription`;
      script.async = true;
      script.onload = () => resolve(window.paypal);
      script.onerror = () => reject(new Error("PayPal SDK failed to load"));
      document.body.appendChild(script);
    });
  }

  return paypalSdkPromise;
}

function getErrorMessage(error) {
  if (!error) {
    return "PayPal checkout failed. Please try again.";
  }

  const rawMessage =
    typeof error === "string"
      ? error
      : error.message || "PayPal checkout failed. Please try again.";

  if (
    rawMessage.includes("RESOURCE_NOT_FOUND") ||
    rawMessage.includes("INVALID_RESOURCE_ID")
  ) {
    return (
      "PayPal plan not found. Use a Plan ID created in the same PayPal " +
      "environment/account as this Client ID."
    );
  }

  return rawMessage;
}

export default function PayPalSubscriptionButton({
  onApproved,
  planCode,
  planId,
  planName
}) {
  const containerRef = useRef(null);
  const [message, setMessage] = useState("Loading PayPal checkout...");
  const clientId = import.meta.env.VITE_PAYPAL_CLIENT_ID;

  useEffect(() => {
    if (!clientId || !planId || !containerRef.current) return;

    let isMounted = true;
    containerRef.current.innerHTML = "";

    loadPayPalSdk(clientId)
      .then((paypal) => {
        if (!isMounted || !containerRef.current) return;

        paypal
          .Buttons({
            style: {
              color: "silver",
              label: "subscribe",
              layout: "vertical",
              shape: "rect",
              tagline: false
            },
            createSubscription: (_data, actions) =>
              actions.subscription.create({
                plan_id: planId
              }),
            onApprove: (data) => {
              onApproved?.({
                planCode,
                subscriptionId: data.subscriptionID
              });
              setMessage(
                `${planName} subscription started. ID: ${data.subscriptionID}`
              );
            },
            onError: (error) => {
              setMessage(getErrorMessage(error));
            }
          })
          .render(containerRef.current)
          .then(() => {
            if (isMounted) {
              setMessage("");
            }
          })
          .catch((error) => {
            setMessage(getErrorMessage(error));
          });
      })
      .catch((error) => {
        setMessage(getErrorMessage(error));
      });

    return () => {
      isMounted = false;
    };
  }, [clientId, onApproved, planCode, planId, planName]);

  if (!clientId) {
    return (
      <p className="payment-note payment-note--error">
        Add VITE_PAYPAL_CLIENT_ID first.
      </p>
    );
  }

  if (!planId) {
    return (
      <p className="payment-note payment-note--error">
        Add the PayPal plan ID for {planName}.
      </p>
    );
  }

  return (
    <div className="paypal-button-wrap">
      <div ref={containerRef} />
      {message && (
        <p
          className={`payment-note ${
            message.toLowerCase().includes("fail") ||
            message.toLowerCase().includes("error") ||
            message.toLowerCase().includes("unable")
              ? "payment-note--error"
              : ""
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
