import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { SiSentry, SiGithub } from "react-icons/si";

const settingsSchema = z.object({
  sentryDsn: z.string().url("Must be a valid Sentry DSN URL"),
  sentryToken: z.string().min(1, "Required"),
  sentryOrg: z.string().min(1, "Required"),
  sentryProject: z.string().min(1, "Required"),
  githubToken: z.string().min(1, "Required"),
  githubOwner: z.string().min(1, "Required"),
  githubRepo: z.string().min(1, "Required"),
});

type Settings = z.infer<typeof settingsSchema>;

export default function Settings() {
  const { toast } = useToast();

  const form = useForm<Settings>({
    resolver: zodResolver(settingsSchema),
  });

  const { data: settings, isLoading } = useQuery<Settings>({
    queryKey: ["/api/settings"],
  });

  const { mutate: saveSettings, isPending } = useMutation({
    mutationFn: async (data: Settings) => {
      await apiRequest("POST", "/api/settings", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({
        title: "Settings saved",
        description: "Your integration settings have been updated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error saving settings",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="p-8">
        <h1 className="text-3xl font-bold mb-8">Settings</h1>
        <div className="space-y-6">
          {[...Array(2)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="h-32 animate-pulse bg-gray-200 rounded-lg" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-8">Settings</h1>

      <div className="space-y-6">
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((data) => saveSettings(data))}
            className="space-y-6"
          >
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <SiSentry className="w-6 h-6" />
                  <div>
                    <CardTitle>Sentry Integration</CardTitle>
                    <CardDescription>
                      Connect your Sentry account to receive error reports
                    </CardDescription>
                  </div>
                  {settings?.sentryDsn && (
                    <Badge variant="outline" className="ml-auto">
                      Connected
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="sentryDsn"
                  defaultValue={settings?.sentryDsn}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Sentry DSN</FormLabel>
                      <FormControl>
                        <Input placeholder="https://..." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="sentryToken"
                  defaultValue={settings?.sentryToken}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>API Token</FormLabel>
                      <FormControl>
                        <Input type="password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="sentryOrg"
                    defaultValue={settings?.sentryOrg}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Organization</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="sentryProject"
                    defaultValue={settings?.sentryProject}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Project</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <SiGithub className="w-6 h-6" />
                  <div>
                    <CardTitle>GitHub Integration</CardTitle>
                    <CardDescription>
                      Connect GitHub to automatically create pull requests with fixes
                    </CardDescription>
                  </div>
                  {settings?.githubToken && (
                    <Badge variant="outline" className="ml-auto">
                      Connected
                    </Badge>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="githubToken"
                  defaultValue={settings?.githubToken}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Personal Access Token</FormLabel>
                      <FormControl>
                        <Input type="password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="githubOwner"
                    defaultValue={settings?.githubOwner}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Repository Owner</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="githubRepo"
                    defaultValue={settings?.githubRepo}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Repository Name</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            <Button type="submit" disabled={isPending} className="ml-auto">
              Save Settings
            </Button>
          </form>
        </Form>
      </div>
    </div>
  );
}
